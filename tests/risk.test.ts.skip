import { describe, it, expect, beforeEach } from 'vitest';
import { RiskManager } from '../src/bot/risk.js';

describe('RiskManager', () => {
  let riskManager: RiskManager;

  beforeEach(() => {
    riskManager = new RiskManager({
      maxPositionSize: 0.1,
      maxOpenOrders: 10,
      dailyLossLimit: 100,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      maxConsecutiveLosses: 3,
      maxDrawdownPercent: 15,
    });
  });

  describe('updateBalance', () => {
    it('should track peak balance', () => {
      riskManager.updateBalance(1000);
      riskManager.updateBalance(1200);
      riskManager.updateBalance(1100);

      const metrics = riskManager.getMetrics();
      expect(metrics.drawdown).toBeCloseTo(8.33, 1);
    });

    it('should calculate drawdown correctly', () => {
      riskManager.updateBalance(1000);
      riskManager.updateBalance(900);

      const metrics = riskManager.getMetrics();
      expect(metrics.drawdown).toBe(10);
    });
  });

  describe('recordTradePnl', () => {
    it('should track daily PnL', () => {
      riskManager.recordTradePnl(50);
      riskManager.recordTradePnl(-20);
      riskManager.recordTradePnl(30);

      const metrics = riskManager.getMetrics();
      expect(metrics.dailyPnl).toBe(60);
    });

    it('should track consecutive losses', () => {
      riskManager.recordTradePnl(-10);
      riskManager.recordTradePnl(-20);

      const metrics = riskManager.getMetrics();
      expect(metrics.consecutiveLosses).toBe(2);
    });

    it('should reset consecutive losses on profit', () => {
      riskManager.recordTradePnl(-10);
      riskManager.recordTradePnl(-20);
      riskManager.recordTradePnl(30);

      const metrics = riskManager.getMetrics();
      expect(metrics.consecutiveLosses).toBe(0);
    });
  });

  describe('canPlaceOrder', () => {
    beforeEach(() => {
      riskManager.updateBalance(10000);
    });

    it('should allow valid orders', () => {
      const result = riskManager.canPlaceOrder('BUY', 0.01, 40000, 0);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('OK');
    });

    it('should reject when daily loss limit reached', () => {
      riskManager.recordTradePnl(-50);
      riskManager.recordTradePnl(-60);

      const result = riskManager.canPlaceOrder('BUY', 0.01, 40000, 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Daily loss limit reached');
    });

    it('should reject when max open orders reached', () => {
      const result = riskManager.canPlaceOrder('BUY', 0.01, 40000, 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max open orders');
    });

    it('should reject when position size exceeded', () => {
      const result = riskManager.canPlaceOrder('BUY', 1, 50000, 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Order exceeds max position size');
    });

    it('should reject after max consecutive losses', () => {
      riskManager.recordTradePnl(-10);
      riskManager.recordTradePnl(-10);
      riskManager.recordTradePnl(-10);

      const result = riskManager.canPlaceOrder('BUY', 0.01, 40000, 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max consecutive losses');
    });

    it('should reject when max drawdown reached', () => {
      riskManager.updateBalance(10000);
      riskManager.updateBalance(8400);

      const result = riskManager.canPlaceOrder('BUY', 0.01, 40000, 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max drawdown');
    });
  });

  describe('checkStopLoss', () => {
    const gridConfig = {
      tradingPair: 'BTCUSDT',
      upperPrice: 45000,
      lowerPrice: 40000,
      gridCount: 10,
      amountPerGrid: 0.001,
      gridType: 'arithmetic' as const,
    };

    it('should trigger stop loss when price drops below threshold', () => {
      const result = riskManager.checkStopLoss(37000, gridConfig);
      expect(result).toBe(true);

      const metrics = riskManager.getMetrics();
      expect(metrics.stopLossTriggered).toBe(true);
    });

    it('should not trigger stop loss above threshold', () => {
      const result = riskManager.checkStopLoss(39000, gridConfig);
      expect(result).toBe(false);
    });
  });

  describe('checkTakeProfit', () => {
    const gridConfig = {
      tradingPair: 'BTCUSDT',
      upperPrice: 45000,
      lowerPrice: 40000,
      gridCount: 10,
      amountPerGrid: 0.001,
      gridType: 'arithmetic' as const,
    };

    it('should trigger take profit when price exceeds threshold', () => {
      const result = riskManager.checkTakeProfit(50000, gridConfig);
      expect(result).toBe(true);

      const metrics = riskManager.getMetrics();
      expect(metrics.takeProfitTriggered).toBe(true);
    });

    it('should not trigger take profit below threshold', () => {
      const result = riskManager.checkTakeProfit(48000, gridConfig);
      expect(result).toBe(false);
    });
  });

  describe('getRiskReport', () => {
    it('should return complete risk report', () => {
      riskManager.updateBalance(10000);
      riskManager.recordTradePnl(50);

      const report = riskManager.getRiskReport();

      expect(report).toHaveProperty('dailyPnl');
      expect(report).toHaveProperty('dailyLossLimit');
      expect(report).toHaveProperty('currentDrawdown');
      expect(report).toHaveProperty('maxDrawdown');
      expect(report).toHaveProperty('consecutiveLosses');
      expect(report).toHaveProperty('riskStatus');
    });

    it('should return NORMAL status for healthy metrics', () => {
      riskManager.updateBalance(10000);

      const report = riskManager.getRiskReport();
      expect(report.riskStatus).toBe('NORMAL');
    });

    it('should return HIGH_RISK when drawdown is high', () => {
      riskManager.updateBalance(10000);
      riskManager.updateBalance(8700);

      const report = riskManager.getRiskReport();
      expect(report.riskStatus).toBe('HIGH_RISK');
    });
  });

  describe('resetDailyMetrics', () => {
    it('should reset daily metrics', () => {
      riskManager.recordTradePnl(-50);
      riskManager.resetDailyMetrics();

      const metrics = riskManager.getMetrics();
      expect(metrics.dailyPnl).toBe(0);
      expect(metrics.stopLossTriggered).toBe(false);
      expect(metrics.takeProfitTriggered).toBe(false);
    });
  });
});
