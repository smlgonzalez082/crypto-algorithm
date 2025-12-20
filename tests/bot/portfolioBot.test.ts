import { jest } from '@jest/globals';
import { PortfolioGridBot } from '../../src/bot/portfolioBot.js';
import { BinanceClient } from '../../src/exchange/binance.js';
import type { PairConfig } from '../../src/types/portfolio.js';

// Mock dependencies
jest.mock('../../src/exchange/binance.js');
jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('PortfolioGridBot', () => {
  let bot: PortfolioGridBot;
  let mockClient: jest.Mocked<BinanceClient>;

  const mockPairConfigs: PairConfig[] = [
    {
      symbol: 'DOGEUSDT',
      baseAsset: 'DOGE',
      quoteAsset: 'USDT',
      gridUpper: 0.18,
      gridLower: 0.10,
      gridCount: 7,
      amountPerGrid: 100,
      gridType: 'arithmetic',
      allocationPercent: 50,
      enabled: true,
    },
    {
      symbol: 'XLMUSDT',
      baseAsset: 'XLM',
      quoteAsset: 'USDT',
      gridUpper: 0.32,
      gridLower: 0.17,
      gridCount: 7,
      amountPerGrid: 50,
      gridType: 'arithmetic',
      allocationPercent: 50,
      enabled: true,
    },
  ];

  beforeEach(() => {
    mockClient = new BinanceClient() as jest.Mocked<BinanceClient>;

    // Setup mock implementations
    mockClient.connect = jest.fn().mockResolvedValue(undefined);
    mockClient.disconnect = jest.fn().mockResolvedValue(undefined);
    mockClient.getBalance = jest.fn().mockResolvedValue({
      free: 2000,
      locked: 0,
      total: 2000,
    });

    bot = new PortfolioGridBot(
      mockClient,
      2000, // totalCapital
      'moderate' // riskStrategy
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct parameters', () => {
      expect(bot).toBeInstanceOf(PortfolioGridBot);
      const status = bot.getStatus();
      expect(status.status).toBe('stopped');
      expect(status.totalCapital).toBe(2000);
      expect(status.riskStrategy).toBe('moderate');
    });

    it('should accept different risk strategies', () => {
      const conservativeBot = new PortfolioGridBot(mockClient, 2000, 'conservative');
      const aggressiveBot = new PortfolioGridBot(mockClient, 2000, 'aggressive');

      expect(conservativeBot.getStatus().riskStrategy).toBe('conservative');
      expect(aggressiveBot.getStatus().riskStrategy).toBe('aggressive');
    });
  });

  describe('addPair()', () => {
    it('should add a pair successfully', async () => {
      const result = await bot.addPair(mockPairConfigs[0]);

      expect(result).toBe(true);
      const pairs = bot.getAllPairs();
      expect(pairs).toContain('DOGEUSDT');
    });

    it('should not add duplicate pair', async () => {
      await bot.addPair(mockPairConfigs[0]);
      const result = await bot.addPair(mockPairConfigs[0]);

      expect(result).toBe(false);
      const pairs = bot.getAllPairs();
      expect(pairs.length).toBe(1);
    });

    it('should handle multiple pairs', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.addPair(mockPairConfigs[1]);

      const pairs = bot.getAllPairs();
      expect(pairs).toContain('DOGEUSDT');
      expect(pairs).toContain('XLMUSDT');
      expect(pairs.length).toBe(2);
    });
  });

  describe('removePair()', () => {
    it('should remove a pair successfully', async () => {
      await bot.addPair(mockPairConfigs[0]);
      const result = await bot.removePair('DOGEUSDT');

      expect(result).toBe(true);
      const pairs = bot.getAllPairs();
      expect(pairs).not.toContain('DOGEUSDT');
    });

    it('should return false for non-existent pair', async () => {
      const result = await bot.removePair('BTCUSDT');

      expect(result).toBe(false);
    });

    it('should not remove pair while bot is running', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.start();

      const result = await bot.removePair('DOGEUSDT');

      expect(result).toBe(false);
      const pairs = bot.getAllPairs();
      expect(pairs).toContain('DOGEUSDT');

      await bot.stop();
    });
  });

  describe('start() and stop()', () => {
    it('should start the portfolio bot', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.start();

      const status = bot.getStatus();
      expect(status.status).toBe('running');
      expect(mockClient.connect).toHaveBeenCalled();

      await bot.stop();
    });

    it('should not start without pairs', async () => {
      await bot.start();

      const status = bot.getStatus();
      expect(status.status).toBe('stopped');
    });

    it('should stop the portfolio bot', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.start();
      await bot.stop();

      const status = bot.getStatus();
      expect(status.status).toBe('stopped');
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    it('should return portfolio status', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.addPair(mockPairConfigs[1]);

      const status = bot.getStatus();

      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('totalCapital');
      expect(status).toHaveProperty('riskStrategy');
      expect(status).toHaveProperty('portfolioValue');
      expect(status).toHaveProperty('totalPnl');
      expect(status).toHaveProperty('activePairs');
      expect(status.activePairs.length).toBe(2);
    });

    it('should calculate portfolio metrics correctly', async () => {
      await bot.addPair(mockPairConfigs[0]);

      const status = bot.getStatus();

      expect(status.portfolioValue).toBeGreaterThanOrEqual(0);
      expect(status.totalPnl).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getPairDetails()', () => {
    it('should return pair details for existing pair', async () => {
      await bot.addPair(mockPairConfigs[0]);

      const details = bot.getPairDetails('DOGEUSDT');

      expect(details).not.toBeNull();
      expect(details?.symbol).toBe('DOGEUSDT');
      expect(details).toHaveProperty('allocation');
      expect(details).toHaveProperty('currentValue');
      expect(details).toHaveProperty('pnl');
    });

    it('should return null for non-existent pair', () => {
      const details = bot.getPairDetails('BTCUSDT');

      expect(details).toBeNull();
    });
  });

  describe('updateStrategy()', () => {
    it('should update risk strategy', async () => {
      const result = await bot.updateStrategy('aggressive');

      expect(result).toBe(true);
      const status = bot.getStatus();
      expect(status.riskStrategy).toBe('aggressive');
    });

    it('should not update strategy while running', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.start();

      const result = await bot.updateStrategy('conservative');

      expect(result).toBe(false);
      const status = bot.getStatus();
      expect(status.riskStrategy).toBe('moderate');

      await bot.stop();
    });
  });

  describe('Portfolio Allocation', () => {
    it('should calculate allocations correctly', async () => {
      await bot.addPair(mockPairConfigs[0]); // 50%
      await bot.addPair(mockPairConfigs[1]); // 50%

      const status = bot.getStatus();
      const totalAllocation = status.activePairs.reduce(
        (sum, pair) => sum + pair.allocation,
        0
      );

      expect(totalAllocation).toBeCloseTo(100, 0);
    });

    it('should respect max exposure limits based on strategy', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.start();

      const status = bot.getStatus();
      const limits = bot.getRiskLimits();

      // Moderate strategy: 75% max exposure
      expect(limits.maxTotalExposure).toBe(0.75);

      await bot.stop();
    });
  });

  describe('getAllPairs()', () => {
    it('should return empty array when no pairs', () => {
      const pairs = bot.getAllPairs();

      expect(Array.isArray(pairs)).toBe(true);
      expect(pairs.length).toBe(0);
    });

    it('should return all added pairs', async () => {
      await bot.addPair(mockPairConfigs[0]);
      await bot.addPair(mockPairConfigs[1]);

      const pairs = bot.getAllPairs();

      expect(pairs.length).toBe(2);
      expect(pairs).toEqual(expect.arrayContaining(['DOGEUSDT', 'XLMUSDT']));
    });
  });

  describe('getRiskLimits()', () => {
    it('should return risk limits for current strategy', () => {
      const limits = bot.getRiskLimits();

      expect(limits).toHaveProperty('maxTotalExposure');
      expect(limits).toHaveProperty('maxDailyLoss');
      expect(limits).toHaveProperty('maxDrawdown');
      expect(limits).toHaveProperty('consecutiveLossLimit');
    });

    it('should have different limits for different strategies', () => {
      const conservativeBot = new PortfolioGridBot(mockClient, 2000, 'conservative');
      const moderateBot = new PortfolioGridBot(mockClient, 2000, 'moderate');
      const aggressiveBot = new PortfolioGridBot(mockClient, 2000, 'aggressive');

      const conservativeLimits = conservativeBot.getRiskLimits();
      const moderateLimits = moderateBot.getRiskLimits();
      const aggressiveLimits = aggressiveBot.getRiskLimits();

      expect(conservativeLimits.maxTotalExposure).toBeLessThan(moderateLimits.maxTotalExposure);
      expect(moderateLimits.maxTotalExposure).toBeLessThan(aggressiveLimits.maxTotalExposure);
    });
  });
});
