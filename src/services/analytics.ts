/**
 * Performance Analytics Service
 * Calculates advanced trading metrics and generates reports
 */

import { tradingDb } from "../models/database.js";

export interface PerformanceMetrics {
  // Overall Performance
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;

  // Trade Statistics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgTradeReturn: number;

  // Time-based Metrics
  avgHoldTime: number; // in hours
  bestHour: number;
  worstHour: number;
  bestDayOfWeek: number;
  worstDayOfWeek: number;

  // Risk Metrics
  volatility: number;
  downsideDeviation: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;

  // Fees
  totalFees: number;
  feesPercent: number;
}

export interface EquityCurvePoint {
  timestamp: Date;
  equity: number;
  drawdown: number;
  drawdownPercent: number;
}

export interface TradeDistribution {
  bins: number[];
  counts: number[];
  avgReturn: number;
  medianReturn: number;
}

export interface PairPerformance {
  symbol: string;
  trades: number;
  winRate: number;
  totalReturn: number;
  avgReturn: number;
  sharpeRatio: number;
  contribution: number; // % of total PnL
}

export interface TimePerformance {
  hour: number;
  trades: number;
  winRate: number;
  avgReturn: number;
}

/**
 * Performance Analytics Service
 */
export class AnalyticsService {
  private feeRate: number = 0.001; // Binance.US 0.1%

  /**
   * Calculate comprehensive performance metrics
   */
  calculatePerformanceMetrics(
    symbol?: string,
    startDate?: Date,
    endDate?: Date,
  ): PerformanceMetrics {
    const trades = this.getTradesInRange(symbol, startDate, endDate);

    if (trades.length === 0) {
      return this.getEmptyMetrics();
    }

    // Separate winning and losing trades
    const winningTrades = trades.filter((t) => t.realizedPnl > 0);
    const losingTrades = trades.filter((t) => t.realizedPnl <= 0);

    // Calculate basic statistics
    const totalReturn = trades.reduce((sum, t) => sum + t.realizedPnl, 0);
    const totalFees = trades.reduce((sum, t) => {
      const cost = t.price * t.quantity;
      return sum + cost * this.feeRate;
    }, 0);

    // Get initial capital from first trade
    const initialCapital = this.estimateInitialCapital(trades);
    const totalReturnPercent = (totalReturn / initialCapital) * 100;

    // Win/Loss statistics
    const winRate = (winningTrades.length / trades.length) * 100;
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.realizedPnl, 0) /
          winningTrades.length
        : 0;
    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.realizedPnl, 0) /
          losingTrades.length
        : 0;

    const largestWin =
      winningTrades.length > 0
        ? Math.max(...winningTrades.map((t) => t.realizedPnl))
        : 0;
    const largestLoss =
      losingTrades.length > 0
        ? Math.min(...losingTrades.map((t) => t.realizedPnl))
        : 0;

    // Profit factor
    const grossProfit = winningTrades.reduce(
      (sum, t) => sum + t.realizedPnl,
      0,
    );
    const grossLoss = Math.abs(
      losingTrades.reduce((sum, t) => sum + t.realizedPnl, 0),
    );
    const profitFactor = grossLoss !== 0 ? grossProfit / grossLoss : 0;

    // Calculate equity curve for advanced metrics
    const equityCurve = this.calculateEquityCurve(trades, initialCapital);
    const { maxDrawdown, maxDrawdownPercent } =
      this.calculateMaxDrawdown(equityCurve);

    // Calculate Sharpe ratio
    const returns = this.calculateReturns(equityCurve);
    const sharpeRatio = this.calculateSharpeRatio(returns);

    // Risk metrics
    const volatility = this.calculateVolatility(returns);
    const downsideDeviation = this.calculateDownsideDeviation(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns, downsideDeviation);
    const calmarRatio =
      maxDrawdownPercent !== 0
        ? (totalReturnPercent / maxDrawdownPercent) * 100
        : 0;

    // Consecutive wins/losses
    const { maxWins, maxLosses } = this.calculateConsecutiveStreaks(trades);

    // Time-based metrics
    const avgHoldTime = this.calculateAvgHoldTime(trades);
    const { bestHour, worstHour } = this.calculateBestWorstHours(trades);
    const { bestDay, worstDay } = this.calculateBestWorstDays(trades);

    return {
      totalReturn,
      totalReturnPercent,
      sharpeRatio,
      profitFactor,
      maxDrawdown,
      maxDrawdownPercent,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      avgTradeReturn: totalReturn / trades.length,
      avgHoldTime,
      bestHour,
      worstHour,
      bestDayOfWeek: bestDay,
      worstDayOfWeek: worstDay,
      volatility,
      downsideDeviation,
      sortinoRatio,
      calmarRatio,
      maxConsecutiveWins: maxWins,
      maxConsecutiveLosses: maxLosses,
      totalFees,
      feesPercent: (totalFees / initialCapital) * 100,
    };
  }

  /**
   * Generate equity curve with drawdown data
   */
  generateEquityCurve(
    symbol?: string,
    startDate?: Date,
    endDate?: Date,
  ): EquityCurvePoint[] {
    const trades = this.getTradesInRange(symbol, startDate, endDate);
    const initialCapital = this.estimateInitialCapital(trades);
    return this.calculateEquityCurve(trades, initialCapital);
  }

  /**
   * Calculate trade distribution histogram
   */
  calculateTradeDistribution(
    symbol?: string,
    startDate?: Date,
    endDate?: Date,
  ): TradeDistribution {
    const trades = this.getTradesInRange(symbol, startDate, endDate);

    const returns = trades.map((t) => t.realizedPnl);
    returns.sort((a, b) => a - b);

    // Create histogram bins
    const min = Math.min(...returns);
    const max = Math.max(...returns);
    const binCount = 20;
    const binSize = (max - min) / binCount;

    const bins: number[] = [];
    const counts: number[] = [];

    for (let i = 0; i < binCount; i++) {
      const binStart = min + i * binSize;
      bins.push(binStart);
      const count = returns.filter(
        (r) => r >= binStart && r < binStart + binSize,
      ).length;
      counts.push(count);
    }

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const medianReturn = returns[Math.floor(returns.length / 2)];

    return {
      bins,
      counts,
      avgReturn,
      medianReturn,
    };
  }

  /**
   * Analyze performance by pair
   */
  analyzePairPerformance(startDate?: Date, endDate?: Date): PairPerformance[] {
    const allTrades = this.getTradesInRange(undefined, startDate, endDate);

    // Group by symbol
    const bySymbol = new Map<string, typeof allTrades>();
    for (const trade of allTrades) {
      if (!bySymbol.has(trade.symbol)) {
        bySymbol.set(trade.symbol, []);
      }
      bySymbol.get(trade.symbol)!.push(trade);
    }

    const totalPnl = allTrades.reduce((sum, t) => sum + t.realizedPnl, 0);

    const pairPerformances: PairPerformance[] = [];

    for (const [symbol, trades] of bySymbol) {
      const wins = trades.filter((t) => t.realizedPnl > 0);
      const winRate = (wins.length / trades.length) * 100;
      const totalReturn = trades.reduce((sum, t) => sum + t.realizedPnl, 0);
      const avgReturn = totalReturn / trades.length;

      const returns = this.tradesToReturns(trades);
      const sharpeRatio = this.calculateSharpeRatio(returns);

      pairPerformances.push({
        symbol,
        trades: trades.length,
        winRate,
        totalReturn,
        avgReturn,
        sharpeRatio,
        contribution: totalPnl !== 0 ? (totalReturn / totalPnl) * 100 : 0,
      });
    }

    return pairPerformances.sort((a, b) => b.totalReturn - a.totalReturn);
  }

  /**
   * Analyze performance by hour of day
   */
  analyzeTimePerformance(
    symbol?: string,
    startDate?: Date,
    endDate?: Date,
  ): TimePerformance[] {
    const trades = this.getTradesInRange(symbol, startDate, endDate);

    const byHour = new Map<number, typeof trades>();

    for (const trade of trades) {
      const hour = new Date(trade.executedAt).getUTCHours();
      if (!byHour.has(hour)) {
        byHour.set(hour, []);
      }
      byHour.get(hour)!.push(trade);
    }

    const hourPerformances: TimePerformance[] = [];

    for (let hour = 0; hour < 24; hour++) {
      const hourTrades = byHour.get(hour) || [];
      if (hourTrades.length === 0) continue;

      const wins = hourTrades.filter((t) => t.realizedPnl > 0);
      const winRate = (wins.length / hourTrades.length) * 100;
      const totalReturn = hourTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
      const avgReturn = totalReturn / hourTrades.length;

      hourPerformances.push({
        hour,
        trades: hourTrades.length,
        winRate,
        avgReturn,
      });
    }

    return hourPerformances;
  }

  // ========================================================================
  // PRIVATE HELPER METHODS
  // ========================================================================

  private getTradesInRange(
    symbol?: string,
    startDate?: Date,
    endDate?: Date,
  ): Array<{
    symbol: string;
    side: string;
    price: number;
    quantity: number;
    realizedPnl: number;
    executedAt: Date;
  }> {
    // Get trades from database
    const allTrades = tradingDb.getTrades(symbol, 10000); // Get up to 10,000 trades

    return allTrades.filter(
      (trade: { symbol: string; executedAt: string | Date }) => {
        if (symbol && trade.symbol !== symbol) return false;
        if (startDate && new Date(trade.executedAt) < startDate) return false;
        if (endDate && new Date(trade.executedAt) > endDate) return false;
        return true;
      },
    );
  }

  private estimateInitialCapital(
    trades: Array<{ price: number; quantity: number }>,
  ): number {
    // Estimate initial capital based on first trade value
    if (trades.length === 0) return 1000;
    const firstTrade = trades[0];
    const tradeValue = firstTrade.price * firstTrade.quantity;
    // Assume first trade is 5% of capital
    return tradeValue * 20;
  }

  private calculateEquityCurve(
    trades: Array<{ realizedPnl: number; executedAt: Date }>,
    initialCapital: number,
  ): EquityCurvePoint[] {
    const curve: EquityCurvePoint[] = [];
    let equity = initialCapital;
    let peak = initialCapital;

    for (const trade of trades) {
      equity += trade.realizedPnl;
      if (equity > peak) peak = equity;

      const drawdown = peak - equity;
      const drawdownPercent = (drawdown / peak) * 100;

      curve.push({
        timestamp: new Date(trade.executedAt),
        equity,
        drawdown,
        drawdownPercent,
      });
    }

    return curve;
  }

  private calculateMaxDrawdown(curve: EquityCurvePoint[]): {
    maxDrawdown: number;
    maxDrawdownPercent: number;
  } {
    if (curve.length === 0) return { maxDrawdown: 0, maxDrawdownPercent: 0 };

    const maxDrawdown = Math.max(...curve.map((p) => p.drawdown));
    const maxDrawdownPercent = Math.max(...curve.map((p) => p.drawdownPercent));

    return { maxDrawdown, maxDrawdownPercent };
  }

  private calculateReturns(curve: EquityCurvePoint[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const prevEquity = curve[i - 1].equity;
      const currEquity = curve[i].equity;
      const dailyReturn = (currEquity - prevEquity) / prevEquity;
      returns.push(dailyReturn);
    }
    return returns;
  }

  private tradesToReturns(
    trades: Array<{ realizedPnl: number; price: number; quantity: number }>,
  ): number[] {
    return trades.map((t) => {
      const tradeValue = t.price * t.quantity;
      return tradeValue !== 0 ? t.realizedPnl / tradeValue : 0;
    });
  }

  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualized Sharpe ratio (assuming ~250 trading days/year)
    return (avgReturn / stdDev) * Math.sqrt(250);
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      returns.length;

    // Annualized volatility
    return Math.sqrt(variance) * Math.sqrt(250) * 100;
  }

  private calculateDownsideDeviation(returns: number[]): number {
    if (returns.length === 0) return 0;

    const negativeReturns = returns.filter((r) => r < 0);
    if (negativeReturns.length === 0) return 0;

    const variance =
      negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) /
      negativeReturns.length;

    return Math.sqrt(variance) * Math.sqrt(250) * 100;
  }

  private calculateSortinoRatio(
    returns: number[],
    downsideDeviation: number,
  ): number {
    if (returns.length === 0 || downsideDeviation === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    return (avgReturn / (downsideDeviation / 100)) * Math.sqrt(250);
  }

  private calculateConsecutiveStreaks(trades: Array<{ realizedPnl: number }>): {
    maxWins: number;
    maxLosses: number;
  } {
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of trades) {
      if (trade.realizedPnl > 0) {
        currentWins++;
        currentLosses = 0;
        maxWins = Math.max(maxWins, currentWins);
      } else {
        currentLosses++;
        currentWins = 0;
        maxLosses = Math.max(maxLosses, currentLosses);
      }
    }

    return { maxWins, maxLosses };
  }

  private calculateAvgHoldTime(trades: Array<{ executedAt: Date }>): number {
    if (trades.length < 2) return 0;

    const holdTimes: number[] = [];
    for (let i = 1; i < trades.length; i++) {
      const timeDiff =
        new Date(trades[i].executedAt).getTime() -
        new Date(trades[i - 1].executedAt).getTime();
      holdTimes.push(timeDiff / (1000 * 60 * 60)); // Convert to hours
    }

    return holdTimes.reduce((sum, t) => sum + t, 0) / holdTimes.length;
  }

  private calculateBestWorstHours(
    trades: Array<{ realizedPnl: number; executedAt: Date }>,
  ): { bestHour: number; worstHour: number } {
    const byHour = new Map<number, number>();

    for (const trade of trades) {
      const hour = new Date(trade.executedAt).getUTCHours();
      byHour.set(hour, (byHour.get(hour) || 0) + trade.realizedPnl);
    }

    let bestHour = 0;
    let bestPnl = -Infinity;
    let worstHour = 0;
    let worstPnl = Infinity;

    for (const [hour, pnl] of byHour) {
      if (pnl > bestPnl) {
        bestPnl = pnl;
        bestHour = hour;
      }
      if (pnl < worstPnl) {
        worstPnl = pnl;
        worstHour = hour;
      }
    }

    return { bestHour, worstHour };
  }

  private calculateBestWorstDays(
    trades: Array<{ realizedPnl: number; executedAt: Date }>,
  ): { bestDay: number; worstDay: number } {
    const byDay = new Map<number, number>();

    for (const trade of trades) {
      const day = new Date(trade.executedAt).getUTCDay(); // 0 = Sunday
      byDay.set(day, (byDay.get(day) || 0) + trade.realizedPnl);
    }

    let bestDay = 0;
    let bestPnl = -Infinity;
    let worstDay = 0;
    let worstPnl = Infinity;

    for (const [day, pnl] of byDay) {
      if (pnl > bestPnl) {
        bestPnl = pnl;
        bestDay = day;
      }
      if (pnl < worstPnl) {
        worstPnl = pnl;
        worstDay = day;
      }
    }

    return { bestDay, worstDay };
  }

  private getEmptyMetrics(): PerformanceMetrics {
    return {
      totalReturn: 0,
      totalReturnPercent: 0,
      sharpeRatio: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      avgTradeReturn: 0,
      avgHoldTime: 0,
      bestHour: 0,
      worstHour: 0,
      bestDayOfWeek: 0,
      worstDayOfWeek: 0,
      volatility: 0,
      downsideDeviation: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      totalFees: 0,
      feesPercent: 0,
    };
  }

  /**
   * Export trades to CSV format for tax reporting
   */
  exportTradesToCSV(symbol?: string, startDate?: Date, endDate?: Date): string {
    const trades = this.getTradesInRange(symbol, startDate, endDate);

    // CSV header
    const header = "Timestamp,Symbol,Side,Price,Quantity,Value,PnL,Fee\n";

    // CSV rows
    const rows = trades
      .map(
        (trade: {
          executedAt: Date;
          symbol: string;
          side: string;
          price: number;
          quantity: number;
          realizedPnl: number;
        }) => {
          const timestamp = new Date(trade.executedAt).toISOString();
          const value = (trade.price * trade.quantity).toFixed(2);
          const pnl = trade.realizedPnl?.toFixed(2) || "0.00";
          const fee = "0.00"; // Placeholder for fee calculation

          return `${timestamp},${trade.symbol},${trade.side},${trade.price},${trade.quantity},${value},${pnl},${fee}`;
        },
      )
      .join("\n");

    return header + rows;
  }
}

// Singleton instance
export const analyticsService = new AnalyticsService();
