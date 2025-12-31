/**
 * Backtesting Framework for Grid Trading Strategies
 * Allows testing grid parameters with historical data before live trading
 */

import { createLogger } from "../utils/logger.js";
import { tradingDb } from "../models/database.js";
import type { PairConfig } from "../types/portfolio.js";

const logger = createLogger("backtesting");

interface BacktestConfig {
  symbol: string;
  gridLower: number;
  gridUpper: number;
  gridCount: number;
  amountPerGrid: number;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
}

interface BacktestTrade {
  timestamp: Date;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  pnl: number;
  gridLevel: number;
}

interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  totalReturn: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  fees: number;
  netPnl: number;
  trades: BacktestTrade[];
  equityCurve: Array<{ timestamp: Date; equity: number }>;
}

interface GridLevel {
  level: number;
  price: number;
  status: "empty" | "bought" | "filled";
  buyPrice?: number;
}

/**
 * Backtesting Engine for Grid Trading Strategies
 */
export class GridBacktester {
  private config: BacktestConfig;
  private gridLevels: GridLevel[] = [];
  private trades: BacktestTrade[] = [];
  private positionSize: number = 0;
  private cash: number;
  private equity: number;
  private equityCurve: Array<{ timestamp: Date; equity: number }> = [];
  private feeRate: number = 0.001; // Binance.US 0.1% fee

  constructor(config: BacktestConfig) {
    this.config = config;
    this.cash = config.initialCapital;
    this.equity = config.initialCapital;
    this.initializeGrid();
  }

  /**
   * Initialize grid levels
   */
  private initializeGrid(): void {
    const range = this.config.gridUpper - this.config.gridLower;
    const spacing = range / this.config.gridCount;

    for (let i = 0; i <= this.config.gridCount; i++) {
      const price = this.config.gridLower + i * spacing;
      this.gridLevels.push({
        level: i,
        price,
        status: "empty",
      });
    }

    logger.info(
      {
        symbol: this.config.symbol,
        gridLevels: this.gridLevels.length,
        lower: this.config.gridLower,
        upper: this.config.gridUpper,
        spacing: spacing.toFixed(4),
      },
      "Grid initialized for backtesting",
    );
  }

  /**
   * Run backtest with historical price data
   */
  runBacktest(): BacktestMetrics {
    logger.info(
      {
        symbol: this.config.symbol,
        startDate: this.config.startDate,
        endDate: this.config.endDate,
      },
      "Starting backtest...",
    );

    // Load historical prices from database
    const priceHistory = tradingDb.getPriceHistory(
      this.config.symbol,
      Math.ceil(
        (this.config.endDate.getTime() - this.config.startDate.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );

    // Filter prices within date range
    const filteredPrices = priceHistory.filter((p) => {
      const timestamp = new Date(p.timestamp);
      return (
        timestamp >= this.config.startDate && timestamp <= this.config.endDate
      );
    });

    logger.info(
      { dataPoints: filteredPrices.length },
      "Loaded historical price data",
    );

    // Process each price point
    for (const pricePoint of filteredPrices) {
      this.processPriceUpdate(pricePoint.price, new Date(pricePoint.timestamp));
    }

    // Calculate final metrics
    const metrics = this.calculateMetrics();

    logger.info(
      {
        totalTrades: metrics.totalTrades,
        winRate: `${metrics.winRate.toFixed(2)}%`,
        totalReturn: `${metrics.totalReturn.toFixed(2)}%`,
        sharpeRatio: metrics.sharpeRatio.toFixed(2),
        maxDrawdown: `${metrics.maxDrawdownPercent.toFixed(2)}%`,
      },
      "Backtest completed",
    );

    return metrics;
  }

  /**
   * Process a price update and check for grid triggers
   */
  private processPriceUpdate(price: number, timestamp: Date): void {
    // Check for sell triggers (price hits upper levels)
    for (const level of this.gridLevels) {
      if (level.status === "bought" && price >= level.price) {
        // Sell at this level
        this.executeSell(level, price, timestamp);
      }
    }

    // Check for buy triggers (price hits lower levels)
    for (const level of this.gridLevels) {
      if (level.status === "empty" && price <= level.price) {
        // Buy at this level
        this.executeBuy(level, price, timestamp);
      }
    }

    // Update equity curve
    this.equity = this.cash + this.positionSize * price;
    this.equityCurve.push({ timestamp, equity: this.equity });
  }

  /**
   * Execute a buy order
   */
  private executeBuy(level: GridLevel, price: number, timestamp: Date): void {
    const cost = this.config.amountPerGrid * price;
    const fee = cost * this.feeRate;

    if (this.cash < cost + fee) {
      // Not enough cash
      return;
    }

    this.cash -= cost + fee;
    this.positionSize += this.config.amountPerGrid;
    level.status = "bought";
    level.buyPrice = price;

    this.trades.push({
      timestamp,
      side: "BUY",
      price,
      quantity: this.config.amountPerGrid,
      pnl: -fee, // Buying costs fees
      gridLevel: level.level,
    });
  }

  /**
   * Execute a sell order
   */
  private executeSell(level: GridLevel, price: number, timestamp: Date): void {
    const revenue = this.config.amountPerGrid * price;
    const fee = revenue * this.feeRate;
    const buyPrice = level.buyPrice || level.price;
    const pnl = (price - buyPrice) * this.config.amountPerGrid - fee * 2; // Buy + sell fees

    this.cash += revenue - fee;
    this.positionSize -= this.config.amountPerGrid;
    level.status = "empty";
    level.buyPrice = undefined;

    this.trades.push({
      timestamp,
      side: "SELL",
      price,
      quantity: this.config.amountPerGrid,
      pnl,
      gridLevel: level.level,
    });
  }

  /**
   * Calculate performance metrics
   */
  private calculateMetrics(): BacktestMetrics {
    const trades = this.trades.filter((t) => t.side === "SELL"); // Only count complete round trips
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const fees = this.trades.reduce((sum, t) => {
      const cost = t.price * t.quantity;
      return sum + cost * this.feeRate;
    }, 0);

    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const totalReturn = (totalPnl / this.config.initialCapital) * 100;

    // Calculate max drawdown
    let peak = this.config.initialCapital;
    let maxDrawdown = 0;
    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = peak - point.equity;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    const maxDrawdownPercent = (maxDrawdown / peak) * 100;

    // Calculate Sharpe Ratio (simplified - using daily returns)
    const returns: number[] = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prevEquity = this.equityCurve[i - 1].equity;
      const currEquity = this.equityCurve[i].equity;
      const dailyReturn = (currEquity - prevEquity) / prevEquity;
      returns.push(dailyReturn);
    }

    const avgReturn =
      returns.length > 0
        ? returns.reduce((sum, r) => sum + r, 0) / returns.length
        : 0;
    const variance =
      returns.length > 0
        ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
          returns.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio =
      stdDev !== 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    // Profit Factor
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss !== 0 ? grossProfit / grossLoss : 0;

    // Win/Loss stats
    const avgWin =
      wins.length > 0
        ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length
        : 0;
    const avgLoss =
      losses.length > 0
        ? losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length
        : 0;
    const largestWin =
      wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0;
    const largestLoss =
      losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0;

    return {
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate,
      totalPnl,
      totalReturn,
      maxDrawdown,
      maxDrawdownPercent,
      sharpeRatio,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      fees,
      netPnl: totalPnl,
      trades: this.trades,
      equityCurve: this.equityCurve,
    };
  }
}

/**
 * Helper function to run a backtest for a pair configuration
 */
export function backtestPairConfig(
  pairConfig: PairConfig,
  startDate: Date,
  endDate: Date,
  initialCapital: number = 1000,
): BacktestMetrics {
  const config: BacktestConfig = {
    symbol: pairConfig.symbol,
    gridLower: pairConfig.gridLower,
    gridUpper: pairConfig.gridUpper,
    gridCount: pairConfig.gridCount,
    amountPerGrid: pairConfig.amountPerGrid,
    startDate,
    endDate,
    initialCapital,
  };

  const backtester = new GridBacktester(config);
  return backtester.runBacktest();
}

/**
 * Compare multiple grid configurations to find the best one
 */
export function optimizeGridParameters(
  symbol: string,
  startDate: Date,
  endDate: Date,
  initialCapital: number = 1000,
  priceHistoryProvider?: (
    symbol: string,
    days: number,
  ) => Array<{ timestamp: number; price: number }>,
): {
  bestConfig: PairConfig;
  bestMetrics: BacktestMetrics;
  allResults: Array<{ config: PairConfig; metrics: BacktestMetrics }>;
} {
  logger.info({ symbol }, "Starting grid parameter optimization...");

  const results: Array<{ config: PairConfig; metrics: BacktestMetrics }> = [];

  // Get current price to determine ranges
  const priceProvider =
    priceHistoryProvider ||
    ((sym, days) => tradingDb.getPriceHistory(sym, days));
  const recentPrices = priceProvider(symbol, 7);
  if (recentPrices.length === 0) {
    throw new Error(`No price history found for ${symbol}`);
  }

  const currentPrice = recentPrices[recentPrices.length - 1].price;

  // Test different grid configurations
  const gridCounts = [5, 8, 10, 15, 20];
  const rangeMultipliers = [0.15, 0.2, 0.25, 0.3]; // ±15%, ±20%, ±25%, ±30%

  for (const gridCount of gridCounts) {
    for (const rangeMultiplier of rangeMultipliers) {
      const gridLower = currentPrice * (1 - rangeMultiplier);
      const gridUpper = currentPrice * (1 + rangeMultiplier);
      const amountPerGrid = initialCapital / (gridCount * 2); // Allocate half capital

      // Extract base and quote assets from symbol
      const baseAsset = symbol.replace(/USDT?$/, "");
      const quoteAsset = symbol.match(/USDT?$/)?.[0] || "USDT";

      const config: PairConfig = {
        symbol,
        baseAsset,
        quoteAsset,
        gridLower,
        gridUpper,
        gridCount,
        amountPerGrid,
        gridType: "arithmetic",
        allocationPercent: 100, // 100% for backtesting
        enabled: true,
      };

      try {
        const metrics = backtestPairConfig(
          config,
          startDate,
          endDate,
          initialCapital,
        );

        results.push({ config, metrics });

        logger.debug(
          {
            gridCount,
            range: `±${(rangeMultiplier * 100).toFixed(0)}%`,
            return: `${metrics.totalReturn.toFixed(2)}%`,
            sharpe: metrics.sharpeRatio.toFixed(2),
          },
          "Backtest result",
        );
      } catch (error) {
        logger.warn({ error, config }, "Backtest failed for config");
      }
    }
  }

  // Find best configuration (by Sharpe ratio or total return)
  const bestResult = results.reduce((best, current) => {
    // Prioritize Sharpe ratio, then total return
    if (current.metrics.sharpeRatio > best.metrics.sharpeRatio) {
      return current;
    } else if (
      current.metrics.sharpeRatio === best.metrics.sharpeRatio &&
      current.metrics.totalReturn > best.metrics.totalReturn
    ) {
      return current;
    }
    return best;
  });

  logger.info(
    {
      bestConfig: {
        gridCount: bestResult.config.gridCount,
        range: `${bestResult.config.gridLower.toFixed(4)} - ${bestResult.config.gridUpper.toFixed(4)}`,
      },
      metrics: {
        return: `${bestResult.metrics.totalReturn.toFixed(2)}%`,
        sharpe: bestResult.metrics.sharpeRatio.toFixed(2),
        winRate: `${bestResult.metrics.winRate.toFixed(2)}%`,
      },
    },
    "Optimization complete - best configuration found",
  );

  return {
    bestConfig: bestResult.config,
    bestMetrics: bestResult.metrics,
    allResults: results,
  };
}
