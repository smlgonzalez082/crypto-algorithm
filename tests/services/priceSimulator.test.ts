/**
 * Price Simulator Tests
 */

import { jest } from '@jest/globals';
import { PriceSimulator } from '../../src/services/priceSimulator.js';
import { createMockDatabase } from '../helpers/mocks.js';

jest.mock('../../src/models/database.js', () => ({
  tradingDb: createMockDatabase(),
}));

jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('PriceSimulator', () => {
  let simulator: PriceSimulator;

  beforeEach(() => {
    jest.clearAllMocks();
    simulator = new PriceSimulator({
      enabled: true,
      volatility: 0.2,
      drift: 0.0,
      updateInterval: 100, // Fast for testing
    });
  });

  afterEach(() => {
    if (simulator.getStatus().running) {
      simulator.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default config', () => {
      const defaultSim = new PriceSimulator();
      const status = defaultSim.getStatus();

      expect(status.enabled).toBe(false);
      expect(status.config.volatility).toBe(0.5);
      expect(status.config.drift).toBe(0.0);
      expect(status.config.updateInterval).toBe(5000);
    });

    it('should initialize with custom config', () => {
      const customSim = new PriceSimulator({
        enabled: true,
        volatility: 0.3,
        drift: 0.05,
        updateInterval: 1000,
      });

      const status = customSim.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.config.volatility).toBe(0.3);
      expect(status.config.drift).toBe(0.05);
      expect(status.config.updateInterval).toBe(1000);
    });
  });

  describe('Price Initialization', () => {
    it('should initialize price for a symbol', () => {
      simulator.initializePrice('DOGEUSDT', 0.14);

      const status = simulator.getStatus();
      const symbolState = status.prices.find((p) => p.symbol === 'DOGEUSDT');

      expect(symbolState).toBeDefined();
      expect(symbolState?.price).toBe(0.14);
    });

    it('should track multiple symbols', () => {
      simulator.initializePrice('DOGEUSDT', 0.14);
      simulator.initializePrice('XLMUSDT', 0.12);

      const status = simulator.getStatus();

      expect(status.prices.length).toBe(2);
      expect(status.prices.find((p) => p.symbol === 'DOGEUSDT')).toBeDefined();
      expect(status.prices.find((p) => p.symbol === 'XLMUSDT')).toBeDefined();
    });
  });

  describe('Price Updates', () => {
    it('should start and stop simulator', () => {
      simulator.initializePrice('DOGEUSDT', 0.14);

      expect(simulator.getStatus().running).toBe(false);

      simulator.start();
      expect(simulator.getStatus().running).toBe(true);

      simulator.stop();
      expect(simulator.getStatus().running).toBe(false);
    });

    it('should generate price updates', (done) => {
      simulator.initializePrice('DOGEUSDT', 0.14);

      let updateCount = 0;
      simulator.onPriceUpdate((symbol, price) => {
        expect(symbol).toBe('DOGEUSDT');
        expect(typeof price).toBe('number');
        expect(price).toBeGreaterThan(0);
        updateCount++;

        if (updateCount >= 3) {
          simulator.stop();
          done();
        }
      });

      simulator.start();
    }, 10000);

    it('should generate different prices over time', (done) => {
      simulator.initializePrice('DOGEUSDT', 0.14);

      const prices: number[] = [];
      simulator.onPriceUpdate((symbol, price) => {
        prices.push(price);

        if (prices.length >= 5) {
          // Prices should vary (with high probability due to randomness)
          const uniquePrices = new Set(prices);
          expect(uniquePrices.size).toBeGreaterThan(1);
          simulator.stop();
          done();
        }
      });

      simulator.start();
    }, 10000);
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      simulator.initializePrice('DOGEUSDT', 0.14);
      simulator.initializePrice('XLMUSDT', 0.12);

      const status = simulator.getStatus();

      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('config');
      expect(status).toHaveProperty('prices');
      expect(status.prices.length).toBe(2);
    });
  });

  describe('getCurrentPrice', () => {
    it('should return current price for a symbol', () => {
      simulator.initializePrice('DOGEUSDT', 0.14);

      const price = simulator.getCurrentPrice('DOGEUSDT');

      expect(price).toBe(0.14);
    });

    it('should return null for unknown symbol', () => {
      const price = simulator.getCurrentPrice('UNKNOWN');

      expect(price).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should not crash when starting without symbols', () => {
      expect(() => {
        simulator.start();
        simulator.stop();
      }).not.toThrow();
    });

    it('should not crash when stopping when not running', () => {
      expect(() => {
        simulator.stop();
      }).not.toThrow();
    });

    it('should handle multiple start calls gracefully', () => {
      simulator.initializePrice('DOGEUSDT', 0.14);

      simulator.start();
      simulator.start(); // Second call

      expect(simulator.getStatus().running).toBe(true);

      simulator.stop();
    });
  });
});
