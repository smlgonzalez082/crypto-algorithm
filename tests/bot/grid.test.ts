import { jest } from '@jest/globals';
import { GridBot } from '../../src/bot/grid.js';
import { BinanceClient } from '../../src/exchange/binance.js';
import { RiskManager } from '../../src/bot/risk.js';
import type { Order, GridLevel } from '../../src/types/index.js';

// Mock the dependencies
jest.mock('../../src/exchange/binance.js');
jest.mock('../../src/bot/risk.js');
jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('GridBot', () => {
  let bot: GridBot;
  let mockClient: jest.Mocked<BinanceClient>;
  let mockRiskManager: jest.Mocked<RiskManager>;

  beforeEach(() => {
    // Create mock instances
    mockClient = new BinanceClient() as jest.Mocked<BinanceClient>;
    mockRiskManager = new RiskManager() as jest.Mocked<RiskManager>;

    // Setup mock implementations
    mockClient.connect = jest.fn().mockResolvedValue(undefined);
    mockClient.disconnect = jest.fn().mockReturnValue(undefined);
    mockClient.getCurrentPrice = jest.fn().mockResolvedValue(0.14);
    mockClient.getBalance = jest.fn().mockResolvedValue({
      free: 1000,
      locked: 0,
      total: 1000
    });
    mockClient.placeOrder = jest.fn().mockResolvedValue({
      orderId: '123',
      tradingPair: 'DOGEUSDT',
      clientOrderId: 'test-order-1',
      side: 'BUY',
      orderType: 'LIMIT',
      price: 0.14,
      quantity: 100,
      filledQuantity: 0,
      status: 'NEW',
      createdAt: new Date(),
    } as Order);
    mockClient.cancelAllOrders = jest.fn().mockResolvedValue(undefined);
    mockClient.startPriceStream = jest.fn().mockReturnValue(undefined);
    mockClient.startUserStream = jest.fn().mockReturnValue(undefined);
    mockClient.onPriceUpdate = jest.fn();
    mockClient.onOrderUpdate = jest.fn();

    mockRiskManager.updateBalance = jest.fn();
    mockRiskManager.canPlaceOrder = jest.fn().mockReturnValue({ allowed: true, reason: '' });
    mockRiskManager.recordTradePnl = jest.fn();

    // Create bot instance
    bot = new GridBot(mockClient, mockRiskManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with correct config', () => {
      expect(bot).toBeInstanceOf(GridBot);
      const status = bot.getStatus();
      expect(status.status).toBe('stopped');
      expect(status.currentPrice).toBe(0);
    });
  });

  describe('start()', () => {
    it('should start the bot successfully', async () => {
      await bot.start();

      expect(mockClient.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.getBalance).toHaveBeenCalledWith('USDT');
      expect(mockClient.getCurrentPrice).toHaveBeenCalled();
      expect(mockClient.startPriceStream).toHaveBeenCalled();
      expect(mockClient.startUserStream).toHaveBeenCalled();

      const status = bot.getStatus();
      expect(status.status).toBe('running');
    });

    it('should not start if already running', async () => {
      await bot.start();
      const firstCallCount = (mockClient.connect as jest.Mock).mock.calls.length;

      await bot.start();
      const secondCallCount = (mockClient.connect as jest.Mock).mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should handle start errors', async () => {
      mockClient.connect.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(bot.start()).rejects.toThrow('Connection failed');

      const status = bot.getStatus();
      expect(status.status).toBe('error');
    });

    it('should update risk manager with balance', async () => {
      await bot.start();

      expect(mockRiskManager.updateBalance).toHaveBeenCalledWith(1000);
    });
  });

  describe('stop()', () => {
    it('should stop the bot successfully', async () => {
      await bot.start();
      await bot.stop();

      expect(mockClient.cancelAllOrders).toHaveBeenCalledTimes(1);
      expect(mockClient.disconnect).toHaveBeenCalledTimes(1);

      const status = bot.getStatus();
      expect(status.status).toBe('stopped');
    });

    it('should not stop if already stopped', async () => {
      await bot.stop();
      const firstCallCount = (mockClient.disconnect as jest.Mock).mock.calls.length;

      await bot.stop();
      const secondCallCount = (mockClient.disconnect as jest.Mock).mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should handle stop errors', async () => {
      await bot.start();
      mockClient.disconnect.mockImplementationOnce(() => {
        throw new Error('Disconnect failed');
      });

      await expect(bot.stop()).rejects.toThrow('Disconnect failed');

      const status = bot.getStatus();
      expect(status.status).toBe('error');
    });
  });

  describe('getStatus()', () => {
    it('should return correct status when stopped', () => {
      const status = bot.getStatus();

      expect(status).toMatchObject({
        status: 'stopped',
        currentPrice: 0,
        activeOrdersCount: 0,
        totalPnl: 0,
        tradesCount: 0,
      });
    });

    it('should return correct status when running', async () => {
      await bot.start();
      const status = bot.getStatus();

      expect(status.status).toBe('running');
      expect(status.currentPrice).toBe(0.14);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getGridLevels()', () => {
    it('should return grid levels after initialization', async () => {
      await bot.start();
      const levels = bot.getGridLevels();

      expect(Array.isArray(levels)).toBe(true);
      expect(levels.length).toBeGreaterThan(0);

      // Check grid level structure
      levels.forEach((level: GridLevel) => {
        expect(level).toHaveProperty('price');
        expect(level).toHaveProperty('status');
        expect(typeof level.price).toBe('number');
      });
    });

    it('should have evenly spaced grid levels for arithmetic grid', async () => {
      await bot.start();
      const levels = bot.getGridLevels();

      if (levels.length > 2) {
        const spacing1 = levels[1].price - levels[0].price;
        const spacing2 = levels[2].price - levels[1].price;

        // Allow small floating point differences
        expect(Math.abs(spacing1 - spacing2)).toBeLessThan(0.0001);
      }
    });
  });

  describe('Price Updates', () => {
    it('should handle price updates', async () => {
      let priceUpdateCallback: ((price: number) => void) | undefined;
      mockClient.onPriceUpdate.mockImplementation((cb) => {
        priceUpdateCallback = cb;
      });

      await bot.start();

      // Simulate price update
      if (priceUpdateCallback) {
        priceUpdateCallback(0.15);
      }

      const status = bot.getStatus();
      expect(status.currentPrice).toBe(0.15);
    });
  });

  describe('Order Management', () => {
    it('should track active orders', async () => {
      await bot.start();

      const status = bot.getStatus();
      expect(status.activeOrdersCount).toBeGreaterThanOrEqual(0);
    });

    it('should respect risk manager limits', async () => {
      mockRiskManager.canPlaceOrder.mockReturnValue({ allowed: false, reason: 'Risk limit exceeded' });

      await bot.start();

      // Verify that orders weren't placed when risk manager says no
      const placeOrderCalls = (mockClient.placeOrder as jest.Mock).mock.calls.length;
      expect(placeOrderCalls).toBe(0);
    });
  });
});
