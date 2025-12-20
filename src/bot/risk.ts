import { createLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import type { GridConfig, RiskLimits, RiskMetrics, OrderSide } from '../types/index.js';

const logger = createLogger('risk');

export class RiskManager {
  private limits: RiskLimits;
  private metrics: RiskMetrics;
  private dailyTrades: number[] = [];
  private peakBalance = 0;
  private currentBalance = 0;
  private lastReset: Date = new Date();

  constructor(limits?: Partial<RiskLimits>) {
    this.limits = {
      maxPositionSize: limits?.maxPositionSize ?? config.maxPositionSize,
      maxOpenOrders: limits?.maxOpenOrders ?? config.maxOpenOrders,
      dailyLossLimit: limits?.dailyLossLimit ?? config.dailyLossLimit,
      stopLossPercent: limits?.stopLossPercent ?? config.stopLossPercent,
      takeProfitPercent: limits?.takeProfitPercent ?? 10,
      maxConsecutiveLosses: limits?.maxConsecutiveLosses ?? 5,
      maxDrawdownPercent: limits?.maxDrawdownPercent ?? 10,
    };

    this.metrics = {
      totalExposure: 0,
      dailyPnl: 0,
      drawdown: 0,
      maxDrawdown: 0,
      consecutiveLosses: 0,
      stopLossTriggered: false,
      takeProfitTriggered: false,
    };
  }

  updateBalance(balance: number): void {
    this.currentBalance = balance;

    if (balance > this.peakBalance) {
      this.peakBalance = balance;
    }

    if (this.peakBalance > 0) {
      this.metrics.drawdown =
        ((this.peakBalance - balance) / this.peakBalance) * 100;

      if (this.metrics.drawdown > this.metrics.maxDrawdown) {
        this.metrics.maxDrawdown = this.metrics.drawdown;
      }
    }
  }

  recordTradePnl(pnl: number): void {
    this.dailyTrades.push(pnl);
    this.metrics.dailyPnl = this.dailyTrades.reduce((sum, p) => sum + p, 0);

    if (pnl < 0) {
      this.metrics.consecutiveLosses++;
    } else {
      this.metrics.consecutiveLosses = 0;
    }
  }

  canPlaceOrder(
    _side: OrderSide,
    quantity: number,
    price: number,
    currentOpenOrders: number
  ): { allowed: boolean; reason: string } {
    // Check daily loss limit
    if (this.metrics.dailyPnl <= -this.limits.dailyLossLimit) {
      return { allowed: false, reason: 'Daily loss limit reached' };
    }

    // Check max open orders
    if (currentOpenOrders >= this.limits.maxOpenOrders) {
      return {
        allowed: false,
        reason: `Max open orders (${this.limits.maxOpenOrders}) reached`,
      };
    }

    // Check position size
    const orderValue = quantity * price;
    if (orderValue > this.limits.maxPositionSize * this.currentBalance) {
      return { allowed: false, reason: 'Order exceeds max position size' };
    }

    // Check consecutive losses
    if (this.metrics.consecutiveLosses >= this.limits.maxConsecutiveLosses) {
      return {
        allowed: false,
        reason: `Max consecutive losses (${this.limits.maxConsecutiveLosses}) reached`,
      };
    }

    // Check drawdown
    if (this.metrics.drawdown >= this.limits.maxDrawdownPercent) {
      return {
        allowed: false,
        reason: `Max drawdown (${this.limits.maxDrawdownPercent}%) reached`,
      };
    }

    return { allowed: true, reason: 'OK' };
  }

  checkStopLoss(currentPrice: number, gridConfig: GridConfig): boolean {
    const stopLossPrice =
      gridConfig.lowerPrice * (1 - this.limits.stopLossPercent / 100);

    if (currentPrice <= stopLossPrice) {
      this.metrics.stopLossTriggered = true;
      logger.warn(
        { currentPrice, stopLossPrice },
        'Stop loss triggered'
      );
      return true;
    }

    return false;
  }

  checkTakeProfit(currentPrice: number, gridConfig: GridConfig): boolean {
    const takeProfitPrice =
      gridConfig.upperPrice * (1 + this.limits.takeProfitPercent / 100);

    if (currentPrice >= takeProfitPrice) {
      this.metrics.takeProfitTriggered = true;
      logger.info(
        { currentPrice, takeProfitPrice },
        'Take profit triggered'
      );
      return true;
    }

    return false;
  }

  resetDailyMetrics(): void {
    this.dailyTrades = [];
    this.metrics.dailyPnl = 0;
    this.metrics.stopLossTriggered = false;
    this.metrics.takeProfitTriggered = false;
    this.lastReset = new Date();
    logger.info('Daily metrics reset');
  }

  shouldResetDaily(): boolean {
    const now = new Date();
    return now.toDateString() !== this.lastReset.toDateString();
  }

  getRiskReport(): Record<string, unknown> {
    return {
      dailyPnl: this.metrics.dailyPnl,
      dailyLossLimit: this.limits.dailyLossLimit,
      dailyPnlPercent:
        this.limits.dailyLossLimit > 0
          ? (this.metrics.dailyPnl / this.limits.dailyLossLimit) * 100
          : 0,
      currentDrawdown: this.metrics.drawdown,
      maxDrawdown: this.metrics.maxDrawdown,
      consecutiveLosses: this.metrics.consecutiveLosses,
      stopLossTriggered: this.metrics.stopLossTriggered,
      takeProfitTriggered: this.metrics.takeProfitTriggered,
      riskStatus: this.getRiskStatus(),
    };
  }

  private getRiskStatus(): string {
    if (this.metrics.stopLossTriggered) return 'STOPPED';
    if (this.metrics.drawdown >= this.limits.maxDrawdownPercent * 0.8)
      return 'HIGH_RISK';
    if (this.metrics.dailyPnl <= -this.limits.dailyLossLimit * 0.8)
      return 'HIGH_RISK';
    if (this.metrics.consecutiveLosses >= this.limits.maxConsecutiveLosses - 1)
      return 'WARNING';
    if (this.metrics.drawdown >= this.limits.maxDrawdownPercent * 0.5)
      return 'MODERATE';
    return 'NORMAL';
  }

  getMetrics(): RiskMetrics {
    return { ...this.metrics };
  }

  getLimits(): RiskLimits {
    return { ...this.limits };
  }
}
