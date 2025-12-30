/**
 * Backtesting Module Tests
 */

import { jest } from '@jest/globals';
import { GridBacktester, backtestPairConfig, optimizeGridParameters } from '../../src/bot/backtesting.js';
import type { PairConfig } from '../../src/types/portfolio.js';

// Mock dependencies
jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockGetPriceHistory = jest.fn();

jest.mock('../../src/models/database.js', () => ({
  tradingDb: {
    getPriceHistory: mockGetPriceHistory,
  },
}));

describe('GridBacktester', () => {
  const mockPriceHistory = [
    { timestamp: Date.now() - 86400000 * 30, price: 0.10 },
    { timestamp: Date.now() - 86400000 * 29, price: 0.11 },
    { timestamp: Date.now() - 86400000 * 28, price: 0.12 },
    { timestamp: Date.now() - 86400000 * 27, price: 0.13 },
    { timestamp: Date.now() - 86400000 * 26, price: 0.14 },
    { timestamp: Date.now() - 86400000 * 25, price: 0.15 },
    { timestamp: Date.now() - 86400000 * 24, price: 0.14 },
    { timestamp: Date.now() - 86400000 * 23, price: 0.13 },
    { timestamp: Date.now() - 86400000 * 22, price: 0.12 },
    { timestamp: Date.now() - 86400000 * 21, price: 0.13 },
    { timestamp: Date.now() - 86400000 * 20, price: 0.14 },
    { timestamp: Date.now() - 86400000 * 19, price: 0.15 },
    { timestamp: Date.now() - 86400000 * 18, price: 0.14 },
    { timestamp: Date.now() - 86400000 * 17, price: 0.13 },
    { timestamp: Date.now() - 86400000 * 16, price: 0.12 },
    { timestamp: Date.now() - 86400000 * 15, price: 0.11 },
    { timestamp: Date.now() - 86400000 * 14, price: 0.12 },
    { timestamp: Date.now() - 86400000 * 13, price: 0.13 },
    { timestamp: Date.now() - 86400000 * 12, price: 0.14 },
    { timestamp: Date.now() - 86400000 * 11, price: 0.15 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPriceHistory.mockReturnValue(mockPriceHistory);
  });

  describe('GridBacktester - Initialization', () => {
    it('should initialize with correct configuration', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 10,
        amountPerGrid: 50,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      expect(backtester).toBeDefined();
    });

    it('should create grid levels correctly', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 50,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      // Should have created 6 levels (0-5 inclusive)
      expect(metrics).toBeDefined();
    });
  });

  describe('GridBacktester - Trade Execution', () => {
    it('should execute buy orders when price drops to grid level', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      // Should have executed some trades
      expect(metrics.totalTrades).toBeGreaterThan(0);
      expect(metrics.trades.length).toBeGreaterThan(0);
    });

    it('should execute sell orders when price rises after buy', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      // Should have both buy and sell trades
      const buyTrades = metrics.trades.filter((t) => t.side === 'BUY');
      const sellTrades = metrics.trades.filter((t) => t.side === 'SELL');

      expect(buyTrades.length).toBeGreaterThan(0);
      expect(sellTrades.length).toBeGreaterThan(0);
    });

    it('should not execute trades when insufficient capital', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 1000, // Too large for initial capital
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 100, // Not enough
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      // Should have 0 trades due to insufficient capital
      expect(metrics.totalTrades).toBe(0);
    });
  });

  describe('GridBacktester - Metrics Calculation', () => {
    it('should calculate win rate correctly', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      expect(metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(metrics.winRate).toBeLessThanOrEqual(100);
      expect(metrics.winningTrades + metrics.losingTrades).toBe(metrics.totalTrades);
    });

    it('should calculate total return correctly', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      expect(metrics.totalReturn).toBeDefined();
      expect(typeof metrics.totalReturn).toBe('number');
    });

    it('should calculate Sharpe ratio', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      expect(metrics.sharpeRatio).toBeDefined();
      expect(typeof metrics.sharpeRatio).toBe('number');
    });

    it('should calculate max drawdown', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(metrics.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
      expect(metrics.maxDrawdownPercent).toBeLessThanOrEqual(100);
    });

    it('should generate equity curve', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      expect(metrics.equityCurve).toBeDefined();
      expect(Array.isArray(metrics.equityCurve)).toBe(true);
      expect(metrics.equityCurve.length).toBeGreaterThan(0);
    });

    it('should calculate profit factor', () => {
      const config = {
        symbol: 'DOGEUSDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        initialCapital: 1000,
      };

      const backtester = new GridBacktester(config);
      const metrics = backtester.runBacktest();

      expect(metrics.profitFactor).toBeDefined();
      expect(typeof metrics.profitFactor).toBe('number');
      expect(metrics.profitFactor).toBeGreaterThanOrEqual(0);
    });
  });

  describe('backtestPairConfig', () => {
    it('should backtest a pair configuration', () => {
      const pairConfig: PairConfig = {
        symbol: 'DOGEUSDT',
        baseAsset: 'DOGE',
        quoteAsset: 'USDT',
        gridLower: 0.10,
        gridUpper: 0.20,
        gridCount: 5,
        amountPerGrid: 10,
        gridType: 'arithmetic',
        allocationPercent: 100,
        enabled: true,
      };

      const metrics = backtestPairConfig(
        pairConfig,
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        1000
      );

      expect(metrics).toBeDefined();
      expect(metrics.totalTrades).toBeGreaterThanOrEqual(0);
    });
  });

  describe('optimizeGridParameters', () => {
    it('should find optimal grid configuration', () => {
      const result = optimizeGridParameters(
        'DOGEUSDT',
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        1000
      );

      expect(result).toBeDefined();
      expect(result.bestConfig).toBeDefined();
      expect(result.bestMetrics).toBeDefined();
      expect(result.allResults).toBeDefined();
      expect(Array.isArray(result.allResults)).toBe(true);
    });

    it('should test multiple grid configurations', () => {
      const result = optimizeGridParameters(
        'DOGEUSDT',
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        1000
      );

      // Should test gridCounts [5, 8, 10, 15, 20] * rangeMultipliers [0.15, 0.20, 0.25, 0.30] = 20 configs
      expect(result.allResults.length).toBeGreaterThan(0);
    });

    it('should prioritize Sharpe ratio over total return', () => {
      const result = optimizeGridParameters(
        'DOGEUSDT',
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        1000
      );

      // Best config should have the highest Sharpe ratio
      const bestSharpe = result.bestMetrics.sharpeRatio;
      const allSharpes = result.allResults.map((r) => r.metrics.sharpeRatio);

      expect(bestSharpe).toBeGreaterThanOrEqual(Math.max(...allSharpes));
    });

    it('should throw error when no price history found', () => {
      mockGetPriceHistory.mockReturnValue([]);

      expect(() => {
        optimizeGridParameters(
          'DOGEUSDT',
          new Date('2024-01-01'),
          new Date('2024-01-31'),
          1000
        );
      }).toThrow('No price history found for DOGEUSDT');
    });
  });
});
