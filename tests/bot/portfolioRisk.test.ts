import { jest } from '@jest/globals';
import { PortfolioRiskManager } from '../../src/bot/portfolioRisk.js';
import type { RiskStrategy, Trade } from '../../src/types/portfolio.js';

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
  const totalCapital = 2000;

  describe('Conservative Strategy', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'conservative');
    });

    it('should initialize with conservative limits', () => {
      const limits = riskManager.getLimits();

      expect(limits.maxTotalExposure).toBe(0.6); // 60%
      expect(limits.maxDailyLoss).toBe(0.025); // 2.5%
      expect(limits.maxDrawdown).toBe(0.1); // 10%
      expect(limits.consecutiveLossLimit).toBe(3);
    });

    it('should respect conservative exposure limits', () => {
      const allocation = riskManager.calculatePairAllocation(
        'DOGEUSDT',
        50, // 50% suggested
        0.5, // 50% correlation
        0.02 // 2% volatility
      );

      // Conservative should reduce allocation
      expect(allocation).toBeLessThan(50);
      expect(allocation).toBeGreaterThan(0);
    });

    it('should block trades after 3 consecutive losses', () => {
      // Record 3 losing trades
      for (let i = 0; i < 3; i++) {
        const trade: Trade = {
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -10,
          fee: 0.1,
        };
        riskManager.recordTrade(trade);
      }

      expect(riskManager.isCircuitBreakerTripped()).toBe(true);
      expect(riskManager.canTrade('DOGEUSDT')).toBe(false);
    });
  });

  describe('Moderate Strategy', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should initialize with moderate limits', () => {
      const limits = riskManager.getLimits();

      expect(limits.maxTotalExposure).toBe(0.75); // 75%
      expect(limits.maxDailyLoss).toBe(0.05); // 5%
      expect(limits.maxDrawdown).toBe(0.15); // 15%
      expect(limits.consecutiveLossLimit).toBe(5);
    });

    it('should allow moderate exposure', () => {
      const allocation = riskManager.calculatePairAllocation(
        'DOGEUSDT',
        50,
        0.5,
        0.02
      );

      expect(allocation).toBeGreaterThan(0);
      expect(allocation).toBeLessThanOrEqual(50);
    });

    it('should block trades after 5 consecutive losses', () => {
      for (let i = 0; i < 5; i++) {
        const trade: Trade = {
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -10,
          fee: 0.1,
        };
        riskManager.recordTrade(trade);
      }

      expect(riskManager.isCircuitBreakerTripped()).toBe(true);
    });
  });

  describe('Aggressive Strategy', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'aggressive');
    });

    it('should initialize with aggressive limits', () => {
      const limits = riskManager.getLimits();

      expect(limits.maxTotalExposure).toBe(0.9); // 90%
      expect(limits.maxDailyLoss).toBe(0.1); // 10%
      expect(limits.maxDrawdown).toBe(0.25); // 25%
      expect(limits.consecutiveLossLimit).toBe(7);
    });

    it('should allow higher exposure', () => {
      const allocation = riskManager.calculatePairAllocation(
        'DOGEUSDT',
        50,
        0.3, // lower correlation
        0.03 // higher volatility
      );

      expect(allocation).toBeGreaterThan(0);
    });

    it('should be more tolerant of losses', () => {
      // Record 5 losing trades
      for (let i = 0; i < 5; i++) {
        const trade: Trade = {
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -10,
          fee: 0.1,
        };
        riskManager.recordTrade(trade);
      }

      // Should still allow trading (limit is 7)
      expect(riskManager.isCircuitBreakerTripped()).toBe(false);
      expect(riskManager.canTrade('DOGEUSDT')).toBe(true);
    });
  });

  describe('calculatePairAllocation()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should reduce allocation for high correlation', () => {
      const lowCorrAllocation = riskManager.calculatePairAllocation(
        'DOGEUSDT',
        50,
        0.2, // low correlation
        0.02
      );

      const highCorrAllocation = riskManager.calculatePairAllocation(
        'XLMUSDT',
        50,
        0.8, // high correlation
        0.02
      );

      expect(highCorrAllocation).toBeLessThan(lowCorrAllocation);
    });

    it('should reduce allocation for high volatility', () => {
      const lowVolAllocation = riskManager.calculatePairAllocation(
        'DOGEUSDT',
        50,
        0.5,
        0.01 // low volatility
      );

      const highVolAllocation = riskManager.calculatePairAllocation(
        'XLMUSDT',
        50,
        0.5,
        0.05 // high volatility
      );

      expect(highVolAllocation).toBeLessThan(lowVolAllocation);
    });

    it('should never exceed suggested allocation', () => {
      const allocation = riskManager.calculatePairAllocation(
        'DOGEUSDT',
        30,
        0.1,
        0.01
      );

      expect(allocation).toBeLessThanOrEqual(30);
    });

    it('should return 0 for negative suggested allocation', () => {
      const allocation = riskManager.calculatePairAllocation(
        'DOGEUSDT',
        -10,
        0.5,
        0.02
      );

      expect(allocation).toBe(0);
    });
  });

  describe('recordTrade()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should record profitable trade', () => {
      const trade: Trade = {
        id: 'trade-1',
        symbol: 'DOGEUSDT',
        side: 'SELL',
        price: 0.15,
        quantity: 100,
        timestamp: new Date(),
        pnl: 10,
        fee: 0.1,
      };

      riskManager.recordTrade(trade);
      const stats = riskManager.getPortfolioStats();

      expect(stats.totalPnl).toBeGreaterThan(0);
      expect(stats.totalTrades).toBe(1);
    });

    it('should track consecutive losses', () => {
      // Record 3 losing trades
      for (let i = 0; i < 3; i++) {
        const trade: Trade = {
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -5,
          fee: 0.1,
        };
        riskManager.recordTrade(trade);
      }

      const events = riskManager.getRiskEvents();
      const consecutiveLossEvent = events.find(
        e => e.type === 'consecutive_loss_limit'
      );

      expect(consecutiveLossEvent).toBeDefined();
    });

    it('should reset consecutive losses on win', () => {
      // Record 2 losses
      for (let i = 0; i < 2; i++) {
        const trade: Trade = {
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -5,
          fee: 0.1,
        };
        riskManager.recordTrade(trade);
      }

      // Record a win
      const winTrade: Trade = {
        id: 'trade-win',
        symbol: 'DOGEUSDT',
        side: 'SELL',
        price: 0.15,
        quantity: 100,
        timestamp: new Date(),
        pnl: 10,
        fee: 0.1,
      };
      riskManager.recordTrade(winTrade);

      // Should not trip circuit breaker
      expect(riskManager.isCircuitBreakerTripped()).toBe(false);
    });
  });

  describe('checkDailyLossLimit()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should trip on exceeding daily loss limit', () => {
      // Record large losing trade (> 5% of capital)
      const trade: Trade = {
        id: 'trade-1',
        symbol: 'DOGEUSDT',
        side: 'BUY',
        price: 0.14,
        quantity: 1000,
        timestamp: new Date(),
        pnl: -150, // 7.5% of 2000
        fee: 1,
      };

      riskManager.recordTrade(trade);

      expect(riskManager.isCircuitBreakerTripped()).toBe(true);
      const events = riskManager.getRiskEvents();
      const dailyLossEvent = events.find(e => e.type === 'daily_loss_limit');
      expect(dailyLossEvent).toBeDefined();
    });
  });

  describe('checkDrawdownLimit()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should calculate drawdown correctly', () => {
      // Simulate series of losing trades
      for (let i = 0; i < 10; i++) {
        const trade: Trade = {
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -20, // Total -200 = 10% drawdown
          fee: 0.1,
        };
        riskManager.recordTrade(trade);
      }

      const stats = riskManager.getPortfolioStats();
      expect(stats.drawdown).toBeCloseTo(0.1, 2);
    });
  });

  describe('canTrade()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should allow trading when no limits exceeded', () => {
      expect(riskManager.canTrade('DOGEUSDT')).toBe(true);
    });

    it('should block trading when circuit breaker tripped', () => {
      // Trip circuit breaker with consecutive losses
      for (let i = 0; i < 5; i++) {
        const trade: Trade = {
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -10,
          fee: 0.1,
        };
        riskManager.recordTrade(trade);
      }

      expect(riskManager.canTrade('DOGEUSDT')).toBe(false);
    });
  });

  describe('getPortfolioStats()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should return correct initial stats', () => {
      const stats = riskManager.getPortfolioStats();

      expect(stats.totalPnl).toBe(0);
      expect(stats.totalTrades).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.drawdown).toBe(0);
    });

    it('should calculate win rate correctly', () => {
      // 3 wins, 2 losses
      for (let i = 0; i < 3; i++) {
        riskManager.recordTrade({
          id: `win-${i}`,
          symbol: 'DOGEUSDT',
          side: 'SELL',
          price: 0.15,
          quantity: 100,
          timestamp: new Date(),
          pnl: 10,
          fee: 0.1,
        });
      }

      for (let i = 0; i < 2; i++) {
        riskManager.recordTrade({
          id: `loss-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -5,
          fee: 0.1,
        });
      }

      const stats = riskManager.getPortfolioStats();
      expect(stats.totalTrades).toBe(5);
      expect(stats.winRate).toBeCloseTo(0.6, 2); // 3/5 = 60%
    });
  });

  describe('resetCircuitBreaker()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should reset circuit breaker', () => {
      // Trip circuit breaker
      for (let i = 0; i < 5; i++) {
        riskManager.recordTrade({
          id: `trade-${i}`,
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          timestamp: new Date(),
          pnl: -10,
          fee: 0.1,
        });
      }

      expect(riskManager.isCircuitBreakerTripped()).toBe(true);

      riskManager.resetCircuitBreaker();

      expect(riskManager.isCircuitBreakerTripped()).toBe(false);
      expect(riskManager.canTrade('DOGEUSDT')).toBe(true);
    });
  });

  describe('getRiskEvents()', () => {
    beforeEach(() => {
      riskManager = new PortfolioRiskManager(totalCapital, 'moderate');
    });

    it('should return empty array initially', () => {
      const events = riskManager.getRiskEvents();

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(0);
    });

    it('should record risk events', () => {
      // Trip daily loss limit
      riskManager.recordTrade({
        id: 'big-loss',
        symbol: 'DOGEUSDT',
        side: 'BUY',
        price: 0.14,
        quantity: 1000,
        timestamp: new Date(),
        pnl: -150,
        fee: 1,
      });

      const events = riskManager.getRiskEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('daily_loss_limit');
      expect(events[0]).toHaveProperty('timestamp');
      expect(events[0]).toHaveProperty('severity');
    });
  });
});
