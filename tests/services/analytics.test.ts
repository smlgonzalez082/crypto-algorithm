/**
 * Analytics Service Tests
 */

import { jest } from '@jest/globals';
import { AnalyticsService } from '../../src/services/analytics.js';
import { createMockTrade } from '../helpers/mocks.js';

const mockGetTrades = jest.fn();

jest.mock('../../src/models/database.js', () => ({
  tradingDb: {
    getTrades: mockGetTrades,
  },
}));

import { tradingDb } from '../../src/models/database.js';

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    analyticsService = new AnalyticsService();
  });

  describe('calculatePerformanceMetrics', () => {
    it('should return empty metrics when no trades', () => {
      mockGetTrades.mockReturnValue([]);

      const metrics = analyticsService.calculatePerformanceMetrics();

      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winningTrades).toBe(0);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.totalPnl).toBe(0);
    });

    it('should calculate metrics correctly for profitable trades', () => {
      const trades = [
        createMockTrade({ realizedPnl: 10 }),
        createMockTrade({ realizedPnl: 20 }),
        createMockTrade({ realizedPnl: 15 }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const metrics = analyticsService.calculatePerformanceMetrics();

      expect(metrics.totalTrades).toBe(3);
      expect(metrics.winningTrades).toBe(3);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.totalPnl).toBe(45);
      expect(metrics.winRate).toBe(100);
    });

    it('should calculate metrics correctly for mixed trades', () => {
      const trades = [
        createMockTrade({ realizedPnl: 10 }),
        createMockTrade({ realizedPnl: -5 }),
        createMockTrade({ realizedPnl: 20 }),
        createMockTrade({ realizedPnl: -8 }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const metrics = analyticsService.calculatePerformanceMetrics();

      expect(metrics.totalTrades).toBe(4);
      expect(metrics.winningTrades).toBe(2);
      expect(metrics.losingTrades).toBe(2);
      expect(metrics.totalPnl).toBe(17);
      expect(metrics.winRate).toBe(50);
    });

    it('should filter trades by symbol', () => {
      const trades = [
        createMockTrade({ symbol: 'DOGEUSDT', realizedPnl: 10 }),
        createMockTrade({ symbol: 'XLMUSDT', realizedPnl: 20 }),
        createMockTrade({ symbol: 'DOGEUSDT', realizedPnl: 15 }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const metrics = analyticsService.calculatePerformanceMetrics('DOGEUSDT');

      expect(metrics.totalTrades).toBe(2);
      expect(metrics.totalPnl).toBe(25);
    });

    it('should filter trades by date range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const trades = [
        createMockTrade({ executedAt: new Date('2024-01-15'), realizedPnl: 10 }),
        createMockTrade({ executedAt: new Date('2023-12-15'), realizedPnl: 20 }),
        createMockTrade({ executedAt: new Date('2024-02-15'), realizedPnl: 15 }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const metrics = analyticsService.calculatePerformanceMetrics(undefined, startDate, endDate);

      expect(metrics.totalTrades).toBe(1);
      expect(metrics.totalPnl).toBe(10);
    });
  });

  describe('generateEquityCurve', () => {
    it('should generate equity curve from trades', () => {
      const trades = [
        createMockTrade({ realizedPnl: 10, executedAt: new Date('2024-01-01') }),
        createMockTrade({ realizedPnl: 20, executedAt: new Date('2024-01-02') }),
        createMockTrade({ realizedPnl: -5, executedAt: new Date('2024-01-03') }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const curve = analyticsService.generateEquityCurve();

      expect(Array.isArray(curve)).toBe(true);
      expect(curve.length).toBeGreaterThan(0);
      expect(curve[0]).toHaveProperty('timestamp');
      expect(curve[0]).toHaveProperty('equity');
    });

    it('should return empty array when no trades', () => {
      mockGetTrades.mockReturnValue([]);

      const curve = analyticsService.generateEquityCurve();

      expect(Array.isArray(curve)).toBe(true);
      expect(curve.length).toBe(0);
    });
  });

  describe('calculateTradeDistribution', () => {
    it('should calculate return distribution', () => {
      const trades = [
        createMockTrade({ realizedPnl: 10 }),
        createMockTrade({ realizedPnl: 20 }),
        createMockTrade({ realizedPnl: -5 }),
        createMockTrade({ realizedPnl: 15 }),
        createMockTrade({ realizedPnl: -8 }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const distribution = analyticsService.calculateTradeDistribution();

      expect(distribution).toHaveProperty('mean');
      expect(distribution).toHaveProperty('median');
      expect(distribution).toHaveProperty('stdDev');
      expect(distribution).toHaveProperty('min');
      expect(distribution).toHaveProperty('max');
    });

    it('should return zeros for empty trades', () => {
      mockGetTrades.mockReturnValue([]);

      const distribution = analyticsService.calculateTradeDistribution();

      expect(distribution.mean).toBe(0);
      expect(distribution.median).toBe(0);
      expect(distribution.stdDev).toBe(0);
    });
  });

  describe('analyzePairPerformance', () => {
    it('should analyze performance by pair', () => {
      const trades = [
        createMockTrade({ symbol: 'DOGEUSDT', realizedPnl: 10 }),
        createMockTrade({ symbol: 'DOGEUSDT', realizedPnl: 20 }),
        createMockTrade({ symbol: 'XLMUSDT', realizedPnl: 15 }),
        createMockTrade({ symbol: 'XLMUSDT', realizedPnl: -5 }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const pairPerformance = analyticsService.analyzePairPerformance();

      expect(Array.isArray(pairPerformance)).toBe(true);
      expect(pairPerformance.length).toBe(2);

      const dogePair = pairPerformance.find((p) => p.symbol === 'DOGEUSDT');
      expect(dogePair).toBeDefined();
      expect(dogePair?.totalTrades).toBe(2);
      expect(dogePair?.totalPnl).toBe(30);
      expect(dogePair?.winRate).toBe(100);

      const xlmPair = pairPerformance.find((p) => p.symbol === 'XLMUSDT');
      expect(xlmPair).toBeDefined();
      expect(xlmPair?.totalTrades).toBe(2);
      expect(xlmPair?.totalPnl).toBe(10);
      expect(xlmPair?.winRate).toBe(50);
    });

    it('should return empty array when no trades', () => {
      mockGetTrades.mockReturnValue([]);

      const pairPerformance = analyticsService.analyzePairPerformance();

      expect(Array.isArray(pairPerformance)).toBe(true);
      expect(pairPerformance.length).toBe(0);
    });
  });

  describe('analyzeTimePerformance', () => {
    it('should analyze performance by hour of day', () => {
      const trades = [
        createMockTrade({ executedAt: new Date('2024-01-01T10:00:00'), realizedPnl: 10 }),
        createMockTrade({ executedAt: new Date('2024-01-01T10:30:00'), realizedPnl: 20 }),
        createMockTrade({ executedAt: new Date('2024-01-01T14:00:00'), realizedPnl: 15 }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const timePerformance = analyticsService.analyzeTimePerformance();

      expect(Array.isArray(timePerformance)).toBe(true);
      expect(timePerformance.length).toBeGreaterThan(0);

      const hour10 = timePerformance.find((t) => t.hour === 10);
      expect(hour10).toBeDefined();
      expect(hour10?.totalTrades).toBe(2);
      expect(hour10?.totalPnl).toBe(30);
    });

    it('should return empty array when no trades', () => {
      mockGetTrades.mockReturnValue([]);

      const timePerformance = analyticsService.analyzeTimePerformance();

      expect(Array.isArray(timePerformance)).toBe(true);
      expect(timePerformance.length).toBe(0);
    });
  });

  describe('exportTradesToCSV', () => {
    it('should export trades to CSV format', () => {
      const trades = [
        createMockTrade({
          executedAt: new Date('2024-01-01T10:00:00'),
          symbol: 'DOGEUSDT',
          side: 'BUY',
          price: 0.14,
          quantity: 100,
          realizedPnl: 10,
        }),
        createMockTrade({
          executedAt: new Date('2024-01-01T11:00:00'),
          symbol: 'DOGEUSDT',
          side: 'SELL',
          price: 0.15,
          quantity: 100,
          realizedPnl: 10,
        }),
      ];

      mockGetTrades.mockReturnValue(trades);

      const csv = analyticsService.exportTradesToCSV();

      expect(typeof csv).toBe('string');
      expect(csv).toContain('Timestamp,Symbol,Side,Price,Quantity,Value,PnL,Fee');
      expect(csv).toContain('DOGEUSDT');
      expect(csv).toContain('BUY');
      expect(csv).toContain('SELL');
    });

    it('should return header only when no trades', () => {
      mockGetTrades.mockReturnValue([]);

      const csv = analyticsService.exportTradesToCSV();

      expect(typeof csv).toBe('string');
      expect(csv).toBe('Timestamp,Symbol,Side,Price,Quantity,Value,PnL,Fee\n');
    });
  });
});
