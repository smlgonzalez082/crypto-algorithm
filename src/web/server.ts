/* eslint-disable @typescript-eslint/require-await */
import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import { createLogger } from "../utils/logger.js";
import {
  config,
  getRecommendedPairs,
  getAlternativePairs,
} from "../utils/config.js";
import { GridBot } from "../bot/grid.js";
import { PortfolioGridBot } from "../bot/portfolioBot.js";
import { BinanceClient } from "../exchange/binance.js";
import { RiskManager } from "../bot/risk.js";
import { correlationAnalyzer } from "../analysis/correlation.js";
import { initCognitoVerifier, authenticateToken } from "../middleware/auth.js";
import {
  backtestPairConfig,
  optimizeGridParameters,
} from "../bot/backtesting.js";
import { analyticsService } from "../services/analytics.js";
import { tradingDb } from "../models/database.js";
import type {
  RiskStrategy,
  PairConfig as IPairConfig,
} from "../types/portfolio.js";
import {
  validateBody,
  BacktestSchema,
  OptimizeGridSchema,
  AddPairSchema,
  UpdateStrategySchema,
  ToggleSimulationSchema,
} from "../middleware/validation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger("server");

// Async handler wrapper for Express routes
type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

function asyncHandler(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export class WebServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocketServer({ server: this.server });
  private bot: GridBot | null = null;
  private portfolioBot: PortfolioGridBot | null = null;
  private binanceClient: BinanceClient;
  private riskManager: RiskManager;
  private clients: Set<WebSocket> = new Set();
  private statusInterval: NodeJS.Timeout | null = null;
  private isPortfolioMode: boolean;

  constructor() {
    this.binanceClient = new BinanceClient();
    this.riskManager = new RiskManager();
    this.isPortfolioMode = config.portfolioMode;

    // Validate authentication requirements in production
    const isProduction = process.env.NODE_ENV === "production";
    if (
      isProduction &&
      (!config.cognitoUserPoolId || !config.cognitoClientId)
    ) {
      logger.error(
        "Authentication is required in production mode. Please configure COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID",
      );
      throw new Error(
        "Security Error: Authentication must be enabled in production mode",
      );
    }

    // Initialize Cognito authentication if configured
    if (config.cognitoUserPoolId && config.cognitoClientId) {
      initCognitoVerifier(config.cognitoUserPoolId, config.cognitoClientId);
      logger.info("Cognito authentication enabled");
    } else {
      logger.warn(
        "⚠️  WARNING: Authentication disabled - Development mode only!",
      );
    }

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    // Security headers
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      }),
    );

    // CORS configuration
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:3000", "http://localhost:3001"];

    this.app.use(
      cors({
        origin: (origin, callback) => {
          // Allow requests with no origin (mobile apps, Postman, etc.)
          if (!origin) return callback(null, true);

          if (allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            logger.warn({ origin }, "Blocked by CORS policy");
            callback(new Error("Not allowed by CORS"));
          }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        maxAge: 86400, // 24 hours
      }),
    );

    // Body parser
    this.app.use(express.json({ limit: "1mb" }));

    // Global rate limiter
    const globalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // Limit each IP to 1000 requests per window
      message: "Too many requests from this IP, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(globalLimiter);

    // API rate limiter
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: "Too many API requests, please try again later.",
    });
    this.app.use("/api/", apiLimiter);

    // Expensive operations rate limiter
    const backtestLimiter = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 10,
      message: "Backtest limit exceeded, please try again later.",
    });
    this.app.use("/api/backtest", backtestLimiter);

    // Apply authentication to all /api/* routes except public endpoints
    this.app.use("/api/*", (req, res, next) => {
      // Skip authentication for public endpoints
      // Note: With /api/* pattern, req.path is "/" and req.originalUrl has the full path
      if (
        req.originalUrl === "/api/health" ||
        req.originalUrl === "/api/auth/config"
      ) {
        next();
        return;
      }
      // Apply authentication middleware
      void authenticateToken(req, res, next);
    });

    this.app.use(express.static(path.join(__dirname, "static")));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/api/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Get Cognito configuration (public endpoint)
    this.app.get("/api/auth/config", (_req: Request, res: Response) => {
      const authEnabled = !!(
        config.cognitoUserPoolId && config.cognitoClientId
      );
      res.json({
        enabled: authEnabled,
        userPoolId: config.cognitoUserPoolId || null,
        clientId: config.cognitoClientId || null,
        region: config.cognitoRegion || null,
        domain: config.cognitoDomain || null,
      });
    });

    // Get bot status (supports both single and portfolio mode)
    this.app.get("/api/status", (_req: Request, res: Response) => {
      if (this.isPortfolioMode && this.portfolioBot) {
        const status = this.portfolioBot.getStatus();
        res.json({
          ...status,
          mode: "portfolio",
          config: {
            simulationMode: config.simulationMode,
          },
        });
        return;
      }

      if (!this.bot) {
        res.json({
          status: "stopped",
          currentPrice: 0,
          gridConfig: null,
          activeOrdersCount: 0,
          totalPnl: 0,
          tradesCount: 0,
          uptime: 0,
          riskReport: {},
          mode: "single",
          config: {
            simulationMode: config.simulationMode,
          },
        });
        return;
      }

      const status = this.bot.getStatus();
      res.json({
        ...status,
        mode: "single",
        config: {
          simulationMode: config.simulationMode,
        },
      });
    });

    // Get grid levels
    this.app.get("/api/grid", (req: Request, res: Response) => {
      const { pair } = req.query as { pair?: string };

      if (this.isPortfolioMode && this.portfolioBot) {
        // If specific pair requested, return just that pair's data
        if (pair) {
          const pairDetails = this.portfolioBot.getPairDetails(pair);
          if (pairDetails) {
            res.json({
              levels: pairDetails.gridLevels,
              currentPrice: pairDetails.currentPrice,
              symbol: pair,
            });
          } else {
            res.status(404).json({
              error: `Pair ${pair} not found`,
              levels: [],
              currentPrice: 0,
            });
          }
          return;
        }

        // Return grid levels for all pairs
        const grids: Record<string, unknown> = {};
        for (const symbol of this.portfolioBot.getAllPairs()) {
          const pairDetails = this.portfolioBot.getPairDetails(symbol);
          if (pairDetails) {
            grids[symbol] = {
              levels: pairDetails.gridLevels,
              currentPrice: pairDetails.currentPrice,
            };
          }
        }
        res.json(grids);
        return;
      }

      if (!this.bot) {
        res.json({ levels: [], currentPrice: 0 });
        return;
      }

      // Single pair mode
      const gridLevels = this.bot.getGridLevels();
      const status = this.bot.getStatus();
      res.json({
        levels: gridLevels,
        currentPrice: status.currentPrice || 0,
      });
    });

    // Get active orders
    this.app.get("/api/orders", (_req: Request, res: Response) => {
      if (this.isPortfolioMode && this.portfolioBot) {
        // Return orders for all pairs
        const orders: Record<string, unknown[]> = {};
        for (const symbol of this.portfolioBot.getAllPairs()) {
          const pairDetails = this.portfolioBot.getPairDetails(symbol);
          if (pairDetails) {
            orders[symbol] = Array.from(pairDetails.activeOrders.values());
          }
        }
        res.json(orders);
        return;
      }

      if (!this.bot) {
        res.json([]);
        return;
      }
      res.json(this.bot.getActiveOrders());
    });

    // Get config
    this.app.get("/api/config", (_req: Request, res: Response) => {
      res.json({
        portfolioMode: this.isPortfolioMode,
        tradingPair: config.tradingPair,
        gridUpper: config.gridUpper,
        gridLower: config.gridLower,
        gridCount: config.gridCount,
        amountPerGrid: config.amountPerGrid,
        gridType: config.gridType,
        simulationMode: config.simulationMode,
        testnet: config.binanceTestnet,
        binanceUs: config.binanceUs,
        totalCapital: config.totalCapital,
        riskStrategy: config.riskStrategy,
      });
    });

    // Get recommended pairs for portfolio trading
    this.app.get("/api/recommended-pairs", (_req: Request, res: Response) => {
      res.json({
        recommended: getRecommendedPairs(),
        alternatives: getAlternativePairs(),
      });
    });

    // Get portfolio state (multi-pair)
    this.app.get("/api/portfolio", (_req: Request, res: Response) => {
      if (!this.portfolioBot) {
        res.json({
          status: "stopped",
          pairs: [],
          totalCapital: config.totalCapital,
          availableCapital: config.totalCapital,
        });
        return;
      }

      const state = this.portfolioBot.getPortfolioState();
      // Convert Maps to plain objects for JSON
      const pairsArray = Array.from(state.pairs.entries()).map(
        ([symbol, pairState]) => ({
          symbol,
          ...pairState,
          gridLevels: pairState.gridLevels.length,
        }),
      );

      res.json({
        status: state.status,
        startTime: state.startTime,
        totalCapital: state.totalCapital,
        availableCapital: state.availableCapital,
        allocatedCapital: state.allocatedCapital,
        pairs: pairsArray,
        riskMetrics: {
          ...state.riskMetrics,
          pairMetrics: Array.from(state.riskMetrics.pairMetrics.entries()),
        },
        correlationMatrix: state.correlationMatrix,
        pauseReason: state.pauseReason,
      });
    });

    // Get correlation data
    this.app.get("/api/correlation", (_req: Request, res: Response) => {
      const report = correlationAnalyzer.getCorrelationReport();
      res.json(report);
    });

    // Get balances
    this.app.get(
      "/api/balances",
      asyncHandler(async (_req: Request, res: Response) => {
        if (!this.binanceClient.connected) {
          await this.binanceClient.connect();
        }
        const balances = await this.binanceClient.getBalances();
        res.json(balances);
      }),
    );

    // Get recent trades (from Binance API)
    this.app.get(
      "/api/trades",
      asyncHandler(async (_req: Request, res: Response) => {
        if (!this.binanceClient.connected) {
          await this.binanceClient.connect();
        }
        const trades = await this.binanceClient.getRecentTrades();
        res.json(trades);
      }),
    );

    // Get trade history from database
    this.app.get("/api/trades/history", (req: Request, res: Response) => {
      try {
        const symbol = req.query.symbol as string | undefined;
        const limit = parseInt(req.query.limit as string) || 100;

        if (this.portfolioBot) {
          const trades = this.portfolioBot.getTradeHistory(symbol, limit);
          res.json(trades);
        } else {
          res.json([]);
        }
      } catch (error) {
        logger.error({ error }, "Failed to get trade history");
        res.status(500).json({ error: "Failed to get trade history" });
      }
    });

    // Get trade statistics
    this.app.get("/api/trades/stats", (req: Request, res: Response) => {
      try {
        const symbol = req.query.symbol as string | undefined;

        if (this.portfolioBot) {
          const stats = this.portfolioBot.getTradeStats(symbol);
          res.json(stats);
        } else {
          res.json({
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalPnl: 0,
            avgPnl: 0,
            winRate: 0,
          });
        }
      } catch (error) {
        logger.error({ error }, "Failed to get trade stats");
        res.status(500).json({ error: "Failed to get trade stats" });
      }
    });

    // Get risk events
    this.app.get("/api/risk/events", (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;

        if (this.portfolioBot) {
          const events = this.portfolioBot.getRiskEvents(limit);
          res.json(events);
        } else {
          res.json([]);
        }
      } catch (error) {
        logger.error({ error }, "Failed to get risk events");
        res.status(500).json({ error: "Failed to get risk events" });
      }
    });

    // Get risk limits
    this.app.get("/api/risk/limits", (_req: Request, res: Response) => {
      try {
        if (this.portfolioBot) {
          const limits = this.portfolioBot.getRiskLimits();
          res.json(limits);
        } else {
          res.json(null);
        }
      } catch (error) {
        logger.error({ error }, "Failed to get risk limits");
        res.status(500).json({ error: "Failed to get risk limits" });
      }
    });

    // ==========================================
    // ANALYTICS ENDPOINTS (Performance Dashboard)
    // ==========================================

    // Get comprehensive performance metrics
    this.app.get(
      "/api/analytics/metrics",
      asyncHandler(async (req: Request, res: Response) => {
        try {
          const { symbol, startDate, endDate } = req.query as {
            symbol?: string;
            startDate?: string;
            endDate?: string;
          };

          const metrics = analyticsService.calculatePerformanceMetrics(
            symbol,
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined,
          );

          res.json(metrics);
        } catch (error) {
          logger.error({ error }, "Failed to calculate performance metrics");
          res
            .status(500)
            .json({ error: "Failed to calculate performance metrics" });
        }
      }),
    );

    // Get equity curve for charting
    this.app.get(
      "/api/analytics/equity-curve",
      asyncHandler(async (req: Request, res: Response) => {
        try {
          const { symbol, startDate, endDate } = req.query as {
            symbol?: string;
            startDate?: string;
            endDate?: string;
          };

          const equityCurve = analyticsService.generateEquityCurve(
            symbol,
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined,
          );

          res.json(equityCurve);
        } catch (error) {
          logger.error({ error }, "Failed to generate equity curve");
          res.status(500).json({ error: "Failed to generate equity curve" });
        }
      }),
    );

    // Get trade distribution histogram
    this.app.get(
      "/api/analytics/distribution",
      asyncHandler(async (req: Request, res: Response) => {
        try {
          const { symbol, startDate, endDate } = req.query as {
            symbol?: string;
            startDate?: string;
            endDate?: string;
          };

          const distribution = analyticsService.calculateTradeDistribution(
            symbol,
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined,
          );

          res.json(distribution);
        } catch (error) {
          logger.error({ error }, "Failed to calculate trade distribution");
          res
            .status(500)
            .json({ error: "Failed to calculate trade distribution" });
        }
      }),
    );

    // Get performance by pair
    this.app.get(
      "/api/analytics/pair-performance",
      asyncHandler(async (req: Request, res: Response) => {
        try {
          const { startDate, endDate } = req.query as {
            startDate?: string;
            endDate?: string;
          };

          const pairPerformance = analyticsService.analyzePairPerformance(
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined,
          );

          res.json(pairPerformance);
        } catch (error) {
          logger.error({ error }, "Failed to analyze pair performance");
          res.status(500).json({ error: "Failed to analyze pair performance" });
        }
      }),
    );

    // Get performance by time (hour/day)
    this.app.get(
      "/api/analytics/time-performance",
      asyncHandler(async (req: Request, res: Response) => {
        try {
          const { symbol, startDate, endDate } = req.query as {
            symbol?: string;
            startDate?: string;
            endDate?: string;
          };

          const timePerformance = analyticsService.analyzeTimePerformance(
            symbol,
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined,
          );

          res.json(timePerformance);
        } catch (error) {
          logger.error({ error }, "Failed to analyze time performance");
          res.status(500).json({ error: "Failed to analyze time performance" });
        }
      }),
    );

    // Export trades to CSV (for tax reporting)
    this.app.get(
      "/api/analytics/export-csv",
      asyncHandler(async (req: Request, res: Response) => {
        try {
          const { symbol, startDate, endDate } = req.query as {
            symbol?: string;
            startDate?: string;
            endDate?: string;
          };

          const csv = analyticsService.exportTradesToCSV(
            symbol,
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined,
          );

          res.setHeader("Content-Type", "text/csv");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="trades-${symbol || "all"}-${Date.now()}.csv"`,
          );
          res.send(csv);
        } catch (error) {
          logger.error({ error }, "Failed to export trades to CSV");
          res.status(500).json({ error: "Failed to export trades to CSV" });
        }
      }),
    );

    // Start bot (single pair mode - legacy)
    this.app.post(
      "/api/start",
      asyncHandler(async (req: Request, res: Response) => {
        if (this.isPortfolioMode) {
          res
            .status(400)
            .json({ error: "Use /api/portfolio/start for portfolio mode" });
          return;
        }

        if (this.bot) {
          const status = this.bot.getStatus();
          if (status.status === "running") {
            res.status(400).json({ error: "Bot is already running" });
            return;
          }
        }

        this.bot = new GridBot(this.binanceClient, this.riskManager);
        await this.bot.start();
        this.startStatusBroadcast();

        // Audit log
        tradingDb.logRiskEvent({
          eventType: "BOT_STARTED",
          description: `Single pair bot started for ${config.tradingPair}`,
          actionTaken: "Bot started",
        });
        logger.info(
          { user: req.user?.username, pair: config.tradingPair },
          "Bot started",
        );

        res.json({ message: "Bot started successfully" });
      }),
    );

    // Start portfolio bot (multi-pair mode)
    this.app.post(
      "/api/portfolio/start",
      asyncHandler(async (req: Request, res: Response) => {
        if (this.portfolioBot) {
          const status = this.portfolioBot.getStatus();
          if (status.status === "running") {
            res.status(400).json({ error: "Portfolio bot is already running" });
            return;
          }
        }

        const {
          pairs = getRecommendedPairs(),
          totalCapital = config.totalCapital,
          riskStrategy = config.riskStrategy as RiskStrategy,
        } = req.body as {
          pairs?: IPairConfig[];
          totalCapital?: number;
          riskStrategy?: RiskStrategy;
        };

        this.portfolioBot = new PortfolioGridBot(this.binanceClient, {
          pairs,
          totalCapital,
          riskStrategy,
          rebalanceThreshold: 10, // 10% deviation triggers rebalance
          rebalanceInterval: 60000, // Check every minute
          priceHistoryDays: 30,
        });

        this.isPortfolioMode = true;
        await this.portfolioBot.start();
        this.startStatusBroadcast();

        // Audit log
        const pairSymbols = Array.isArray(pairs)
          ? pairs.map((p) => p.symbol).join(", ")
          : "default pairs";
        tradingDb.logRiskEvent({
          eventType: "PORTFOLIO_BOT_STARTED",
          description: `Portfolio bot started with ${pairSymbols}`,
          value: totalCapital,
          actionTaken: `Strategy: ${riskStrategy}`,
        });
        logger.info(
          {
            user: req.user?.username,
            pairs: pairSymbols,
            capital: totalCapital,
            strategy: riskStrategy,
          },
          "Portfolio bot started",
        );

        res.json({
          message: "Portfolio bot started successfully",
          pairs: Array.isArray(pairs) ? pairs.map((p) => p.symbol) : [],
          totalCapital,
          riskStrategy,
        });
      }),
    );

    // Stop bot
    this.app.post(
      "/api/stop",
      asyncHandler(async (req: Request, res: Response) => {
        if (this.isPortfolioMode && this.portfolioBot) {
          await this.portfolioBot.stop();
          this.stopStatusBroadcast();

          // Audit log
          tradingDb.logRiskEvent({
            eventType: "PORTFOLIO_BOT_STOPPED",
            description: "Portfolio bot stopped by user",
            actionTaken: "Bot stopped",
          });
          logger.info({ user: req.user?.username }, "Portfolio bot stopped");

          res.json({ message: "Portfolio bot stopped successfully" });
          return;
        }

        if (!this.bot) {
          res.status(400).json({ error: "Bot is not running" });
          return;
        }

        await this.bot.stop();
        this.stopStatusBroadcast();

        // Audit log
        tradingDb.logRiskEvent({
          eventType: "BOT_STOPPED",
          description: "Single pair bot stopped by user",
          actionTaken: "Bot stopped",
        });
        logger.info({ user: req.user?.username }, "Bot stopped");

        res.json({ message: "Bot stopped successfully" });
      }),
    );

    // Add pair to portfolio
    this.app.post(
      "/api/portfolio/pair",
      validateBody(AddPairSchema),
      asyncHandler(async (req: Request, res: Response) => {
        if (!this.portfolioBot) {
          res.status(400).json({ error: "Portfolio bot not running" });
          return;
        }

        const { symbol, pair } = req.body as {
          symbol?: string;
          pair?: IPairConfig;
        };

        // If just a symbol is provided, create a default PairConfig
        if (symbol && !pair) {
          // Use a default price for initial setup (will be updated when bot starts)
          const currentPrice = 0.35; // Default middle price for grid calculation

          // Extract base and quote assets
          const baseAsset = symbol.replace("USDT", "").replace("USD", "");
          const quoteAsset = symbol.includes("USDT") ? "USDT" : "USD";

          // Create grid range: ±20% from current price
          const gridUpper = currentPrice * 1.2;
          const gridLower = currentPrice * 0.8;

          // Calculate amount per grid based on portfolio capital
          const portfolioValue =
            this.portfolioBot.getPortfolioState().totalCapital;
          const allocationPercent =
            100 / (this.portfolioBot.getAllPairs().length + 1); // Divide evenly
          const pairCapital = (portfolioValue * allocationPercent) / 100;
          const amountPerGrid = pairCapital / config.gridCount;

          const newPair: IPairConfig = {
            symbol,
            baseAsset,
            quoteAsset,
            gridUpper,
            gridLower,
            gridCount: config.gridCount,
            amountPerGrid,
            gridType: "arithmetic",
            allocationPercent,
            enabled: true,
          };

          await this.portfolioBot.addPair(newPair);
          res.json({
            message: `Added ${symbol} to portfolio`,
            pair: newPair,
          });
        } else if (pair) {
          // Full PairConfig provided
          await this.portfolioBot.addPair(pair);
          res.json({ message: `Added ${pair.symbol} to portfolio` });
        } else {
          res
            .status(400)
            .json({ error: "Must provide either 'symbol' or 'pair'" });
        }
      }),
    );

    // Remove pair from portfolio
    this.app.delete(
      "/api/portfolio/pair/:symbol",
      asyncHandler(async (req: Request, res: Response) => {
        if (!this.portfolioBot) {
          res.status(400).json({ error: "Portfolio bot not running" });
          return;
        }

        const { symbol } = req.params;
        await this.portfolioBot.removePair(symbol);
        res.json({ message: `Removed ${symbol} from portfolio` });
      }),
    );

    // Update risk strategy
    this.app.put(
      "/api/portfolio/strategy",
      validateBody(UpdateStrategySchema),
      (req: Request, res: Response) => {
        if (!this.portfolioBot) {
          res.status(400).json({ error: "Portfolio bot not running" });
          return;
        }

        const { strategy } = req.body as { strategy: RiskStrategy };
        this.portfolioBot.updateRiskStrategy(strategy);

        // Audit log
        tradingDb.logRiskEvent({
          eventType: "RISK_STRATEGY_CHANGED",
          description: `Risk strategy updated to ${strategy}`,
          actionTaken: `New strategy: ${strategy}`,
        });
        logger.warn(
          { user: req.user?.username, strategy },
          "Risk strategy changed",
        );

        res.json({ message: `Risk strategy updated to ${strategy}` });
      },
    );

    // Toggle simulation mode
    this.app.put(
      "/api/simulation",
      validateBody(ToggleSimulationSchema),
      (req: Request, res: Response) => {
        const { enabled, confirmLiveTrading } = req.body as {
          enabled: boolean;
          confirmLiveTrading?: boolean;
        };

        // Require confirmation for live trading
        if (!enabled && !confirmLiveTrading) {
          res.status(400).json({
            error: "Live trading requires explicit confirmation",
            message: "Set confirmLiveTrading: true to enable live trading mode",
          });
          return;
        }

        // Check if bot is running
        const isRunning =
          (this.portfolioBot &&
            this.portfolioBot.getStatus().status === "running") ||
          (this.bot && this.bot.getStatus().status === "running");

        if (isRunning) {
          res.status(400).json({
            error:
              "Cannot change simulation mode while bot is running. Stop the bot first.",
          });
          return;
        }

        // Update config - this modifies the runtime config object
        (config as { simulationMode: boolean }).simulationMode = enabled;

        // Audit log
        tradingDb.logRiskEvent({
          eventType: "SIMULATION_MODE_CHANGED",
          description: `Simulation mode ${enabled ? "enabled" : "disabled"}`,
          value: enabled ? 1 : 0,
          actionTaken: enabled ? "Simulation enabled" : "LIVE TRADING enabled",
        });
        logger.warn(
          { simulationMode: enabled, user: req.user?.username },
          "Simulation mode changed",
        );

        res.json({
          message: `Simulation mode ${enabled ? "enabled" : "disabled"}`,
          simulationMode: enabled,
          warning: enabled
            ? null
            : "⚠️  LIVE TRADING ENABLED - Real orders will be placed!",
        });
      },
    );

    // Backtesting endpoints
    this.app.post(
      "/api/backtest",
      validateBody(BacktestSchema),
      asyncHandler(async (req: Request, res: Response) => {
        const {
          symbol,
          gridLower,
          gridUpper,
          gridCount,
          amountPerGrid,
          startDate,
          endDate,
          initialCapital,
        } = req.body as {
          symbol: string;
          gridLower: number;
          gridUpper: number;
          gridCount: number;
          amountPerGrid: number;
          startDate: string;
          endDate: string;
          initialCapital: number;
        };

        // Extract base and quote assets from symbol
        const baseAsset = symbol.replace(/USDT?$/, "");
        const quoteAsset = symbol.match(/USDT?$/)?.[0] || "USDT";

        const pairConfig: IPairConfig = {
          symbol,
          baseAsset,
          quoteAsset,
          gridLower,
          gridUpper,
          gridCount,
          amountPerGrid,
          gridType: "arithmetic",
          allocationPercent: 100,
          enabled: true,
        };

        try {
          const metrics = backtestPairConfig(
            pairConfig,
            new Date(startDate),
            new Date(endDate),
            initialCapital,
          );

          res.json(metrics);
        } catch (error) {
          logger.error({ error }, "Backtest failed");
          res.status(500).json({ error: "Backtest failed" });
        }
      }),
    );

    // Optimize grid parameters using backtesting
    this.app.post(
      "/api/backtest/optimize",
      validateBody(OptimizeGridSchema),
      asyncHandler(async (req: Request, res: Response) => {
        const { symbol, startDate, endDate, initialCapital } = req.body as {
          symbol: string;
          startDate: string;
          endDate: string;
          initialCapital: number;
        };

        try {
          const result = optimizeGridParameters(
            symbol,
            new Date(startDate),
            new Date(endDate),
            initialCapital,
          );

          res.json(result);
        } catch (error) {
          logger.error({ error }, "Grid optimization failed");
          res.status(500).json({ error: "Grid optimization failed" });
        }
      }),
    );

    // Serve frontend
    this.app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "static", "index.html"));
    });

    // Global error handler (must be last)
    this.app.use(
      (err: Error, req: Request, res: Response, _next: NextFunction) => {
        logger.error(
          { err, url: req.url, method: req.method },
          "Unhandled error",
        );

        // Don't send error details if headers already sent
        if (res.headersSent) {
          return;
        }

        // In production, don't leak error details
        const isDevelopment = process.env.NODE_ENV !== "production";
        res.status(500).json({
          error: "Internal server error",
          ...(isDevelopment && {
            details: err.message,
            stack: err.stack?.split("\n").slice(0, 5),
          }),
        });
      },
    );
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket, req) => {
      void (async () => {
        try {
          // Extract token from query string
          const url = new URL(req.url || "", "ws://localhost");
          const token = url.searchParams.get("token");

          // Authenticate WebSocket connection (skip if auth not configured)
          if (config.cognitoUserPoolId && config.cognitoClientId) {
            if (!token) {
              logger.warn(
                "WebSocket connection rejected: No authentication token",
              );
              ws.close(1008, "Authentication required");
              return;
            }

            // Verify token using the same JWT verifier
            const { getCognitoVerifier } =
              await import("../middleware/auth.js");
            const verifier = getCognitoVerifier();
            if (verifier) {
              try {
                await verifier.verify(token);
                logger.info("Authenticated WebSocket client connected");
              } catch (error) {
                logger.warn({ error }, "WebSocket authentication failed");
                ws.close(1008, "Authentication failed");
                return;
              }
            }
          } else {
            logger.debug("WebSocket auth skipped (dev mode)");
          }

          this.clients.add(ws);

          // Send initial status
          if (this.isPortfolioMode && this.portfolioBot) {
            ws.send(
              JSON.stringify({
                type: "portfolio",
                data: this.portfolioBot.getStatus(),
              }),
            );
          } else if (this.bot) {
            ws.send(
              JSON.stringify({ type: "status", data: this.bot.getStatus() }),
            );
          }

          ws.on("close", () => {
            logger.info("WebSocket client disconnected");
            this.clients.delete(ws);
          });

          ws.on("error", (error) => {
            logger.error({ error }, "WebSocket error");
            this.clients.delete(ws);
          });
        } catch (error) {
          logger.error({ error }, "WebSocket connection error");
          ws.close(1011, "Internal error");
        }
      })();
    });
  }

  private broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private startStatusBroadcast(): void {
    if (this.statusInterval) return;

    this.statusInterval = setInterval(() => {
      if (this.isPortfolioMode && this.portfolioBot) {
        this.broadcast({
          type: "portfolio",
          data: this.portfolioBot.getStatus(),
        });

        // Also send per-pair details
        for (const symbol of this.portfolioBot.getAllPairs()) {
          const pairDetails = this.portfolioBot.getPairDetails(symbol);
          if (pairDetails) {
            this.broadcast({
              type: "pair",
              symbol,
              data: {
                price: pairDetails.currentPrice,
                pnl: pairDetails.realizedPnl + pairDetails.unrealizedPnl,
                trades: pairDetails.tradesCount,
                orders: pairDetails.activeOrders.size,
              },
            });
          }
        }
      } else if (this.bot) {
        this.broadcast({ type: "status", data: this.bot.getStatus() });
        this.broadcast({ type: "grid", data: this.bot.getGridLevels() });
        this.broadcast({ type: "orders", data: this.bot.getActiveOrders() });
      }
    }, 1000);
  }

  private stopStatusBroadcast(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(config.serverPort, () => {
        logger.info(
          { port: config.serverPort, portfolioMode: this.isPortfolioMode },
          `Server running at http://localhost:${config.serverPort}`,
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.stopStatusBroadcast();

    if (this.portfolioBot) {
      await this.portfolioBot.stop();
    }

    if (this.bot) {
      await this.bot.stop();
    }

    for (const client of this.clients) {
      client.close();
    }

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
