import { jest } from '@jest/globals';
import { PortfolioRiskManager } from '../../src/bot/portfolioRisk.js';

jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('PortfolioRiskManager', () => {
  let riskManager: PortfolioRiskManager;

  describe('Conservative Strategy', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('conservative');
    });

    it('should initialize with conservative limits', () => {
      const limits = riskManager.getLimits();

      expect(limits.maxTotalExposure).toBe(60); // 60%
      expect(limits.maxDailyLossPercent).toBe(2.5); // 2.5%
      expect(limits.maxDrawdownPercent).toBe(10); // 10%
      expect(limits.pauseOnConsecutiveLosses).toBe(3);
    });

    it('should block trades after 3 consecutive losses', () => {
      riskManager.updatePortfolioValue(2000);

      // Record 3 losing trades
      for (let i = 0; i < 3; i++) {
        riskManager.recordTrade('DOGEUSDT', -10);
      }

      const status = riskManager.getStatus();
      expect(status.isPaused).toBe(true);
    });
  });

  describe('Moderate Strategy', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
    });

    it('should initialize with moderate limits', () => {
      const limits = riskManager.getLimits();

      expect(limits.maxTotalExposure).toBe(75); // 75%
      expect(limits.maxDailyLossPercent).toBe(5); // 5%
      expect(limits.maxDrawdownPercent).toBe(15); // 15%
      expect(limits.pauseOnConsecutiveLosses).toBe(5);
    });

    it('should block trades after 5 consecutive losses', () => {
      riskManager.updatePortfolioValue(2000);

      for (let i = 0; i < 5; i++) {
        riskManager.recordTrade('DOGEUSDT', -10);
      }

      const status = riskManager.getStatus();
      expect(status.isPaused).toBe(true);
    });
  });

  describe('Aggressive Strategy', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('aggressive');
    });

    it('should initialize with aggressive limits', () => {
      const limits = riskManager.getLimits();

      expect(limits.maxTotalExposure).toBe(90); // 90%
      expect(limits.maxDailyLossPercent).toBe(10); // 10%
      expect(limits.maxDrawdownPercent).toBe(25); // 25%
      expect(limits.pauseOnConsecutiveLosses).toBe(7);
    });

    it('should be more tolerant of losses', () => {
      riskManager.updatePortfolioValue(2000);

      // Record 5 losing trades
      for (let i = 0; i < 5; i++) {
        riskManager.recordTrade('DOGEUSDT', -10);
      }

      // Should still allow trading (limit is 7)
      const status = riskManager.getStatus();
      expect(status.isPaused).toBe(false);
    });
  });

  describe('recordTrade()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
      riskManager.updatePortfolioValue(2000);
    });

    it('should record profitable trade', () => {
      riskManager.recordTrade('DOGEUSDT', 10);

      const status = riskManager.getStatus();
      expect(status.dailyPnl).toBe(10);
    });

    it('should track consecutive losses', () => {
      // Record 3 losing trades
      for (let i = 0; i < 3; i++) {
        riskManager.recordTrade('DOGEUSDT', -5);
      }

      const status = riskManager.getStatus();
      expect(status.consecutiveLosses).toBe(3);
    });

    it('should reset consecutive losses on win', () => {
      // Record 2 losses
      for (let i = 0; i < 2; i++) {
        riskManager.recordTrade('DOGEUSDT', -5);
      }

      // Record a win
      riskManager.recordTrade('DOGEUSDT', 10);

      const status = riskManager.getStatus();
      expect(status.consecutiveLosses).toBe(0);
    });
  });

  describe('canPlaceOrder()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
      riskManager.updatePortfolioValue(2000);
    });

    it('should allow trading when no limits exceeded', () => {
      const result = riskManager.canPlaceOrder('DOGEUSDT', 'BUY', 100, 0.14, 5, 10);

      expect(result.allowed).toBe(true);
    });

    it('should block trading when circuit breaker tripped', () => {
      // Trip circuit breaker with consecutive losses
      for (let i = 0; i < 5; i++) {
        riskManager.recordTrade('DOGEUSDT', -10);
      }

      const result = riskManager.canPlaceOrder('DOGEUSDT', 'BUY', 100, 0.14, 5, 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('paused');
    });

    it('should block when max orders per pair reached', () => {
      const limits = riskManager.getLimits();
      const result = riskManager.canPlaceOrder(
        'DOGEUSDT',
        'BUY',
        100,
        0.14,
        limits.maxOpenOrdersPerPair,
        20
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max orders per pair');
    });

    it('should block when total orders limit reached', () => {
      const limits = riskManager.getLimits();
      const result = riskManager.canPlaceOrder(
        'DOGEUSDT',
        'BUY',
        100,
        0.14,
        5,
        limits.maxTotalOpenOrders
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max total orders');
    });
  });

  describe('updatePortfolioValue()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
    });

    it('should track peak portfolio value', () => {
      riskManager.updatePortfolioValue(2000);
      riskManager.updatePortfolioValue(2500);
      riskManager.updatePortfolioValue(2200);

      const drawdown = riskManager.getCurrentDrawdown();
      // Drawdown from peak 2500 to current 2200 = 12%
      expect(drawdown).toBeCloseTo(12, 1);
    });

    it('should calculate drawdown correctly', () => {
      riskManager.updatePortfolioValue(2000);
      riskManager.updatePortfolioValue(1800);

      const drawdown = riskManager.getCurrentDrawdown();
      // Drawdown from peak 2000 to current 1800 = 10%
      expect(drawdown).toBe(10);
    });
  });

  describe('getStatus()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
      riskManager.updatePortfolioValue(2000);
    });

    it('should return correct status', () => {
      riskManager.recordTrade('DOGEUSDT', -5);
      riskManager.recordTrade('DOGEUSDT', 10);

      const status = riskManager.getStatus();

      expect(status).toHaveProperty('isPaused');
      expect(status).toHaveProperty('pauseReason');
      expect(status).toHaveProperty('strategy');
      expect(status).toHaveProperty('dailyPnl');
      expect(status).toHaveProperty('drawdown');
      expect(status).toHaveProperty('consecutiveLosses');
      expect(status.strategy).toBe('moderate');
    });
  });

  describe('resume()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
      riskManager.updatePortfolioValue(2000);
    });

    it('should resume trading after pause', () => {
      // Trip circuit breaker
      for (let i = 0; i < 5; i++) {
        riskManager.recordTrade('DOGEUSDT', -10);
      }

      expect(riskManager.getStatus().isPaused).toBe(true);

      riskManager.resume();

      expect(riskManager.getStatus().isPaused).toBe(false);
      expect(riskManager.getStatus().consecutiveLosses).toBe(0);
    });
  });

  describe('setStrategy()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
    });

    it('should change strategy and update limits', () => {
      riskManager.setStrategy('aggressive');

      const status = riskManager.getStatus();
      const limits = riskManager.getLimits();

      expect(status.strategy).toBe('aggressive');
      expect(limits.maxTotalExposure).toBe(90);
    });

    it('should update from conservative to moderate', () => {
      const conservativeManager = new PortfolioRiskManager('conservative');
      conservativeManager.setStrategy('moderate');

      const limits = conservativeManager.getLimits();
      expect(limits.maxTotalExposure).toBe(75);
      expect(limits.pauseOnConsecutiveLosses).toBe(5);
    });
  });

  describe('updateLimits()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager('moderate');
    });

    it('should update specific limits', () => {
      riskManager.updateLimits({ maxDailyLoss: 150 });

      const limits = riskManager.getLimits();
      expect(limits.maxDailyLoss).toBe(150);
      // Other limits should remain unchanged
      expect(limits.maxTotalExposure).toBe(75);
    });

    it('should allow partial limit updates', () => {
      const originalLimits = riskManager.getLimits();

      riskManager.updateLimits({
        maxCorrelation: 0.7,
        pauseOnConsecutiveLosses: 10,
      });

      const newLimits = riskManager.getLimits();
      expect(newLimits.maxCorrelation).toBe(0.7);
      expect(newLimits.pauseOnConsecutiveLosses).toBe(10);
      expect(newLimits.maxTotalExposure).toBe(originalLimits.maxTotalExposure);
    });
  });
});
