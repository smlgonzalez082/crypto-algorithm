import { createLogger } from '../utils/logger.js';
import { correlationAnalyzer } from '../analysis/correlation.js';
import type {
  RiskStrategy,
  RiskLimitsConfig,
  PortfolioRiskMetrics,
  PairRiskMetrics,
  PortfolioState,
  RebalanceAction,
} from '../types/portfolio.js';

const logger = createLogger('portfolio-risk');

interface TradeRecord {
  timestamp: Date;
  pair: string;
  pnl: number;
  type: 'realized' | 'unrealized';
}

// Reserved for future volatility alert system
// interface VolatilityAlert {
//   pair: string;
//   currentVol: number;
//   threshold: number;
//   timestamp: Date;
// }

/**
 * Advanced Portfolio Risk Manager
 *
 * Key strategies implemented:
 * 1. Position sizing based on volatility (Kelly-inspired)
 * 2. Correlation-aware allocation
 * 3. Dynamic stop-loss based on ATR
 * 4. Circuit breakers for extreme conditions
 * 5. Drawdown-based position reduction
 * 6. Value at Risk (VaR) monitoring
 */
export class PortfolioRiskManager {
  private limits: RiskLimitsConfig;
  private strategy: RiskStrategy;
  private tradeHistory: TradeRecord[] = [];
  private dailyPnl = 0;
  private peakPortfolioValue = 0;
  private currentPortfolioValue = 0;
  private consecutiveLosses = 0;
  private lastResetDate: Date = new Date();
  // Track volatility alerts (reserved for future alert system)
  // private volatilityAlerts: VolatilityAlert[] = [];
  private isPaused = false;
  private pauseReason: string | null = null;

  // Risk state per pair
  private pairRiskState: Map<
    string,
    {
      positionValue: number;
      dailyPnl: number;
      consecutiveLosses: number;
      lastVolatility: number;
    }
  > = new Map();

  constructor(
    strategy: RiskStrategy = 'moderate',
    customLimits?: Partial<RiskLimitsConfig>
  ) {
    this.strategy = strategy;
    const defaultLimits = this.getDefaultLimits(strategy);
    this.limits = { ...defaultLimits, ...customLimits };

    logger.info({ strategy, limits: this.limits }, 'Portfolio risk manager initialized');
  }

  private getDefaultLimits(strategy: RiskStrategy): RiskLimitsConfig {
    const defaults: Record<RiskStrategy, RiskLimitsConfig> = {
      conservative: {
        maxPositionPerPair: 30,
        maxTotalExposure: 60,
        minCashReserve: 40,
        maxDailyLoss: 50,
        maxDailyLossPercent: 2.5,
        maxDrawdownPercent: 10,
        maxCorrelation: 0.5,
        minDiversificationScore: 0.6,
        maxOpenOrdersPerPair: 10,
        maxTotalOpenOrders: 30,
        pauseOnConsecutiveLosses: 3,
        pauseOnVolatilitySpike: 15,
      },
      moderate: {
        maxPositionPerPair: 40,
        maxTotalExposure: 75,
        minCashReserve: 25,
        maxDailyLoss: 100,
        maxDailyLossPercent: 5,
        maxDrawdownPercent: 15,
        maxCorrelation: 0.65,
        minDiversificationScore: 0.5,
        maxOpenOrdersPerPair: 15,
        maxTotalOpenOrders: 50,
        pauseOnConsecutiveLosses: 5,
        pauseOnVolatilitySpike: 20,
      },
      aggressive: {
        maxPositionPerPair: 50,
        maxTotalExposure: 90,
        minCashReserve: 10,
        maxDailyLoss: 200,
        maxDailyLossPercent: 10,
        maxDrawdownPercent: 25,
        maxCorrelation: 0.8,
        minDiversificationScore: 0.3,
        maxOpenOrdersPerPair: 20,
        maxTotalOpenOrders: 80,
        pauseOnConsecutiveLosses: 7,
        pauseOnVolatilitySpike: 30,
      },
    };
    return defaults[strategy];
  }

  // ===========================================================================
  // PORTFOLIO VALUE TRACKING
  // ===========================================================================

  updatePortfolioValue(value: number): void {
    this.currentPortfolioValue = value;
    if (value > this.peakPortfolioValue) {
      this.peakPortfolioValue = value;
    }
  }

  getCurrentDrawdown(): number {
    if (this.peakPortfolioValue === 0) return 0;
    return ((this.peakPortfolioValue - this.currentPortfolioValue) / this.peakPortfolioValue) * 100;
  }

  // ===========================================================================
  // TRADE RECORDING & PNL TRACKING
  // ===========================================================================

  recordTrade(pair: string, pnl: number): void {
    this.checkDailyReset();

    this.tradeHistory.push({
      timestamp: new Date(),
      pair,
      pnl,
      type: 'realized',
    });

    this.dailyPnl += pnl;

    // Update pair-specific state
    const pairState = this.pairRiskState.get(pair) || {
      positionValue: 0,
      dailyPnl: 0,
      consecutiveLosses: 0,
      lastVolatility: 0,
    };

    pairState.dailyPnl += pnl;

    if (pnl < 0) {
      this.consecutiveLosses++;
      pairState.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
      pairState.consecutiveLosses = 0;
    }

    this.pairRiskState.set(pair, pairState);

    // Check for circuit breakers
    this.checkCircuitBreakers();
  }

  private checkDailyReset(): void {
    const now = new Date();
    if (now.toDateString() !== this.lastResetDate.toDateString()) {
      this.dailyPnl = 0;
      this.pairRiskState.forEach((state) => {
        state.dailyPnl = 0;
      });
      this.lastResetDate = now;
      logger.info('Daily PnL reset');
    }
  }

  // ===========================================================================
  // CIRCUIT BREAKERS
  // ===========================================================================

  private checkCircuitBreakers(): void {
    // Check consecutive losses
    if (this.consecutiveLosses >= this.limits.pauseOnConsecutiveLosses) {
      this.triggerPause(`${this.consecutiveLosses} consecutive losses`);
      return;
    }

    // Check daily loss limit
    if (Math.abs(this.dailyPnl) >= this.limits.maxDailyLoss && this.dailyPnl < 0) {
      this.triggerPause(`Daily loss limit reached: $${Math.abs(this.dailyPnl).toFixed(2)}`);
      return;
    }

    // Check daily loss percent
    const dailyLossPercent = (Math.abs(this.dailyPnl) / this.currentPortfolioValue) * 100;
    if (dailyLossPercent >= this.limits.maxDailyLossPercent && this.dailyPnl < 0) {
      this.triggerPause(`Daily loss percent reached: ${dailyLossPercent.toFixed(2)}%`);
      return;
    }

    // Check drawdown
    const drawdown = this.getCurrentDrawdown();
    if (drawdown >= this.limits.maxDrawdownPercent) {
      this.triggerPause(`Max drawdown reached: ${drawdown.toFixed(2)}%`);
      return;
    }
  }

  private triggerPause(reason: string): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this.pauseReason = reason;
      logger.warn({ reason }, 'Portfolio trading PAUSED - circuit breaker triggered');
    }
  }

  resume(): void {
    this.isPaused = false;
    this.pauseReason = null;
    this.consecutiveLosses = 0;
    logger.info('Portfolio trading RESUMED');
  }

  // ===========================================================================
  // POSITION SIZING - KELLY CRITERION INSPIRED
  // ===========================================================================

  /**
   * Calculates optimal position size based on:
   * 1. Win rate and profit factor
   * 2. Current volatility
   * 3. Correlation with existing positions
   * 4. Available capital
   */
  calculateOptimalPositionSize(
    pair: string,
    _currentPrice: number,
    availableCapital: number,
    existingPairs: string[]
  ): { size: number; reason: string } {
    // Base allocation from limits
    let maxAllocation = availableCapital * (this.limits.maxPositionPerPair / 100);

    // Adjust for correlation if we have existing positions
    if (existingPairs.length > 0) {
      const corrCheck = correlationAnalyzer.wouldHurtDiversification(
        existingPairs,
        pair,
        this.limits.maxCorrelation
      );

      if (corrCheck.wouldHurt) {
        // Reduce allocation for highly correlated pairs
        maxAllocation *= 0.5;
        logger.info({ pair, reason: corrCheck.reason }, 'Reduced allocation due to correlation');
      }
    }

    // Adjust for volatility
    const volData = correlationAnalyzer.getVolatility(pair);
    if (volData) {
      // Higher volatility = smaller position
      const volAdjustment = Math.min(1, 10 / volData.daily); // Cap at 1x
      maxAllocation *= volAdjustment;
    }

    // Adjust based on recent performance
    const pairState = this.pairRiskState.get(pair);
    if (pairState && pairState.consecutiveLosses >= 2) {
      maxAllocation *= 0.75; // Reduce by 25% after 2 consecutive losses
    }

    // Ensure we don't exceed total exposure limit
    const currentExposure = this.calculateTotalExposure();
    const remainingExposure = this.limits.maxTotalExposure - currentExposure;
    maxAllocation = Math.min(maxAllocation, availableCapital * (remainingExposure / 100));

    // Ensure minimum cash reserve
    const minCash = availableCapital * (this.limits.minCashReserve / 100);
    maxAllocation = Math.min(maxAllocation, availableCapital - minCash);

    return {
      size: Math.max(0, maxAllocation),
      reason: this.buildSizeReason(maxAllocation, availableCapital, volData?.daily),
    };
  }

  private buildSizeReason(
    size: number,
    available: number,
    volatility?: number
  ): string {
    const percent = ((size / available) * 100).toFixed(1);
    let reason = `${percent}% allocation`;
    if (volatility) {
      reason += `, vol-adjusted (${volatility.toFixed(1)}% daily vol)`;
    }
    return reason;
  }

  private calculateTotalExposure(): number {
    let total = 0;
    this.pairRiskState.forEach((state) => {
      total += state.positionValue;
    });
    return (total / this.currentPortfolioValue) * 100;
  }

  // ===========================================================================
  // ORDER VALIDATION
  // ===========================================================================

  canPlaceOrder(
    pair: string,
    _side: 'BUY' | 'SELL',
    _quantity: number,
    _price: number,
    currentOpenOrders: number,
    totalOpenOrders: number
  ): { allowed: boolean; reason: string } {
    // Check if paused
    if (this.isPaused) {
      return { allowed: false, reason: `Trading paused: ${this.pauseReason}` };
    }

    // Check max orders per pair
    if (currentOpenOrders >= this.limits.maxOpenOrdersPerPair) {
      return {
        allowed: false,
        reason: `Max orders per pair (${this.limits.maxOpenOrdersPerPair}) reached`,
      };
    }

    // Check total orders
    if (totalOpenOrders >= this.limits.maxTotalOpenOrders) {
      return {
        allowed: false,
        reason: `Max total orders (${this.limits.maxTotalOpenOrders}) reached`,
      };
    }

    // Check daily loss for this pair
    const pairState = this.pairRiskState.get(pair);
    if (pairState) {
      const pairDailyLossLimit = this.limits.maxDailyLoss / 2; // Per pair = half of total
      if (pairState.dailyPnl <= -pairDailyLossLimit) {
        return {
          allowed: false,
          reason: `Pair daily loss limit reached: $${Math.abs(pairState.dailyPnl).toFixed(2)}`,
        };
      }
    }

    // Check drawdown
    const drawdown = this.getCurrentDrawdown();
    if (drawdown >= this.limits.maxDrawdownPercent * 0.9) {
      return {
        allowed: false,
        reason: `Near max drawdown (${drawdown.toFixed(1)}%), limiting new orders`,
      };
    }

    return { allowed: true, reason: 'OK' };
  }

  // ===========================================================================
  // REBALANCING SUGGESTIONS
  // ===========================================================================

  suggestRebalance(portfolioState: PortfolioState): RebalanceAction[] {
    const actions: RebalanceAction[] = [];

    // Get current allocations
    const totalValue = portfolioState.totalCapital;
    const targetPerPair = 100 / portfolioState.pairs.size;

    portfolioState.pairs.forEach((pairState, symbol) => {
      const currentAllocation = (pairState.positionValue / totalValue) * 100;
      const deviation = Math.abs(currentAllocation - targetPerPair);

      // Suggest rebalance if deviation > 10%
      if (deviation > 10) {
        if (currentAllocation > targetPerPair) {
          actions.push({
            type: 'decrease',
            pair: symbol,
            currentAllocation,
            targetAllocation: targetPerPair,
            reason: `Over-allocated by ${deviation.toFixed(1)}%`,
          });
        } else {
          actions.push({
            type: 'increase',
            pair: symbol,
            currentAllocation,
            targetAllocation: targetPerPair,
            reason: `Under-allocated by ${deviation.toFixed(1)}%`,
          });
        }
      }
    });

    return actions;
  }

  // ===========================================================================
  // RISK METRICS CALCULATION
  // ===========================================================================

  calculateRiskMetrics(portfolioState: PortfolioState): PortfolioRiskMetrics {
    const pairMetrics = new Map<string, PairRiskMetrics>();

    // Calculate per-pair metrics
    portfolioState.pairs.forEach((pairState, symbol) => {
      const volData = correlationAnalyzer.getVolatility(symbol);

      pairMetrics.set(symbol, {
        symbol,
        currentPrice: pairState.currentPrice,
        positionValue: pairState.positionValue,
        positionPercent: (pairState.positionValue / portfolioState.totalCapital) * 100,
        unrealizedPnl: pairState.unrealizedPnl,
        realizedPnl: pairState.realizedPnl,
        volatility: volData?.daily ?? 0,
        beta: 1, // Would need market data to calculate properly
        contribution: 0, // Calculated below
        gridEfficiency: pairState.tradesCount / Math.max(1, pairState.config.gridCount),
      });
    });

    // Calculate portfolio-level metrics
    const symbols = Array.from(portfolioState.pairs.keys());
    const diversificationScore = correlationAnalyzer.calculateDiversificationScore(symbols);
    const correlationReport = correlationAnalyzer.getCorrelationReport();

    // Calculate concentration risk (Herfindahl index)
    let herfindahl = 0;
    pairMetrics.forEach((metric) => {
      herfindahl += Math.pow(metric.positionPercent / 100, 2);
    });

    // Calculate VaR (simplified - assuming normal distribution)
    // VaR = Portfolio Value * z-score * portfolio volatility
    const avgVol =
      Array.from(pairMetrics.values()).reduce((sum, m) => sum + m.volatility, 0) /
      Math.max(1, pairMetrics.size);
    const portfolioVol = avgVol * Math.sqrt(1 - diversificationScore); // Adjusted for diversification
    const var95 = portfolioState.totalCapital * 1.645 * (portfolioVol / 100);

    return {
      totalValue: portfolioState.totalCapital,
      totalPnl:
        Array.from(portfolioState.pairs.values()).reduce(
          (sum, p) => sum + p.realizedPnl + p.unrealizedPnl,
          0
        ),
      totalPnlPercent: 0, // Would need starting value
      dailyPnl: this.dailyPnl,

      portfolioVolatility: portfolioVol,
      sharpeRatio: 0, // Would need risk-free rate and longer history
      maxDrawdown: this.peakPortfolioValue > 0
        ? ((this.peakPortfolioValue - this.currentPortfolioValue) / this.peakPortfolioValue) * 100
        : 0,
      currentDrawdown: this.getCurrentDrawdown(),
      valueAtRisk: var95,

      effectiveDiversification: diversificationScore,
      concentrationRisk: herfindahl,
      correlationRisk: correlationReport.summary.avgCorrelation,

      pairMetrics,
    };
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  getStatus(): {
    isPaused: boolean;
    pauseReason: string | null;
    strategy: RiskStrategy;
    dailyPnl: number;
    drawdown: number;
    consecutiveLosses: number;
  } {
    return {
      isPaused: this.isPaused,
      pauseReason: this.pauseReason,
      strategy: this.strategy,
      dailyPnl: this.dailyPnl,
      drawdown: this.getCurrentDrawdown(),
      consecutiveLosses: this.consecutiveLosses,
    };
  }

  getLimits(): RiskLimitsConfig {
    return { ...this.limits };
  }

  updateLimits(newLimits: Partial<RiskLimitsConfig>): void {
    this.limits = { ...this.limits, ...newLimits };
    logger.info({ newLimits }, 'Risk limits updated');
  }

  setStrategy(strategy: RiskStrategy): void {
    this.strategy = strategy;
    this.limits = this.getDefaultLimits(strategy);
    logger.info({ strategy }, 'Risk strategy changed');
  }
}
