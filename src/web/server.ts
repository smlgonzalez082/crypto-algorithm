import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
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
import type {
  RiskStrategy,
  PairConfig as IPairConfig,
} from "../types/portfolio.js";

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

    // Initialize Cognito authentication if configured
    if (config.cognitoUserPoolId && config.cognitoClientId) {
      initCognitoVerifier(config.cognitoUserPoolId, config.cognitoClientId);
      logger.info("Cognito authentication enabled");
    } else {
      logger.info(
        "Cognito not configured, authentication disabled (local dev mode)",
      );
    }

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());

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
        res.json(this.portfolioBot.getStatus());
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
        });
        return;
      }
      res.json(this.bot.getStatus());
    });

    // Get grid levels
    this.app.get("/api/grid", (_req: Request, res: Response) => {
      if (this.isPortfolioMode && this.portfolioBot) {
        // Return grid levels for all pairs
        const grids: Record<string, unknown> = {};
        for (const symbol of this.portfolioBot.getAllPairs()) {
          const pairDetails = this.portfolioBot.getPairDetails(symbol);
          if (pairDetails) {
            grids[symbol] = pairDetails.gridLevels;
          }
        }
        res.json(grids);
        return;
      }

      if (!this.bot) {
        res.json([]);
        return;
      }
      res.json(this.bot.getGridLevels());
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

    // Start bot (single pair mode - legacy)
    this.app.post(
      "/api/start",
      asyncHandler(async (_req: Request, res: Response) => {
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
      asyncHandler(async (_req: Request, res: Response) => {
        if (this.isPortfolioMode && this.portfolioBot) {
          await this.portfolioBot.stop();
          this.stopStatusBroadcast();
          res.json({ message: "Portfolio bot stopped successfully" });
          return;
        }

        if (!this.bot) {
          res.status(400).json({ error: "Bot is not running" });
          return;
        }

        await this.bot.stop();
        this.stopStatusBroadcast();

        res.json({ message: "Bot stopped successfully" });
      }),
    );

    // Add pair to portfolio
    this.app.post(
      "/api/portfolio/pair",
      asyncHandler(async (req: Request, res: Response) => {
        if (!this.portfolioBot) {
          res.status(400).json({ error: "Portfolio bot not running" });
          return;
        }

        const { pair } = req.body as { pair: IPairConfig };
        await this.portfolioBot.addPair(pair);
        res.json({ message: `Added ${pair.symbol} to portfolio` });
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
    this.app.put("/api/portfolio/strategy", (req: Request, res: Response) => {
      if (!this.portfolioBot) {
        res.status(400).json({ error: "Portfolio bot not running" });
        return;
      }

      const { strategy } = req.body as { strategy: RiskStrategy };
      this.portfolioBot.updateRiskStrategy(strategy);
      res.json({ message: `Risk strategy updated to ${strategy}` });
    });

    // Toggle simulation mode
    this.app.put("/api/simulation", (req: Request, res: Response) => {
      const { enabled } = req.body as { enabled: boolean };

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

      logger.info({ simulationMode: enabled }, "Simulation mode updated");
      res.json({
        message: `Simulation mode ${enabled ? "enabled" : "disabled"}`,
        simulationMode: enabled,
        warning: enabled
          ? null
          : "LIVE TRADING ENABLED - Real orders will be placed!",
      });
    });

    // Serve frontend
    this.app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "static", "index.html"));
    });
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      logger.info("WebSocket client connected");
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
        ws.send(JSON.stringify({ type: "status", data: this.bot.getStatus() }));
      }

      ws.on("close", () => {
        logger.info("WebSocket client disconnected");
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        logger.error({ error }, "WebSocket error");
        this.clients.delete(ws);
      });
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
