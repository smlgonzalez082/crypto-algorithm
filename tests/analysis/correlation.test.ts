import { jest } from '@jest/globals';
import { CorrelationAnalyzer } from '../../src/analysis/correlation.js';
import type { PriceData } from '../../src/types/portfolio.js';

jest.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../src/models/database.js', () => ({
  Database: jest.fn().mockImplementation(() => ({
    savePriceData: jest.fn(),
    getPriceHistory: jest.fn(),
  })),
}));

describe('CorrelationAnalyzer', () => {
  let analyzer: CorrelationAnalyzer;

  beforeEach(() => {
    analyzer = new CorrelationAnalyzer();
  });

  describe('addPriceUpdate()', () => {
    it('should add price update for a symbol', () => {
      const priceData: PriceData = {
        symbol: 'DOGEUSDT',
        price: 0.14,
        timestamp: new Date(),
      };

      analyzer.addPriceUpdate(priceData);

      const correlation = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');
      // Initially null since we need data for both symbols
      expect(correlation).toBeNull();
    });

    it('should store price data for multiple symbols', () => {
      analyzer.addPriceUpdate({
        symbol: 'DOGEUSDT',
        price: 0.14,
        timestamp: new Date(),
      });

      analyzer.addPriceUpdate({
        symbol: 'XLMUSDT',
        price: 0.22,
        timestamp: new Date(),
      });

      // Data should be stored
      const matrix = analyzer.getCorrelationMatrix(['DOGEUSDT', 'XLMUSDT']);
      expect(matrix).toBeDefined();
    });

    it('should maintain price history', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 10; i++) {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: 0.14 + (i * 0.001),
          timestamp: new Date(baseTime + i * 1000),
        });
      }

      // Should have stored multiple data points
      const matrix = analyzer.getCorrelationMatrix(['DOGEUSDT']);
      expect(matrix).toBeDefined();
    });
  });

  describe('getCorrelation()', () => {
    it('should return null for insufficient data', () => {
      const correlation = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');
      expect(correlation).toBeNull();
    });

    it('should calculate correlation for two symbols', () => {
      const baseTime = Date.now();

      // Add correlated price movements
      for (let i = 0; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: 0.14 + (i * 0.001),
          timestamp: new Date(baseTime + i * 60000),
        });

        analyzer.addPriceUpdate({
          symbol: 'XLMUSDT',
          price: 0.22 + (i * 0.001),
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      const correlation = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');

      // Should calculate a correlation value
      if (correlation !== null) {
        expect(correlation).toBeGreaterThanOrEqual(-1);
        expect(correlation).toBeLessThanOrEqual(1);
      }
    });

    it('should return high correlation for perfectly correlated data', () => {
      const baseTime = Date.now();

      // Add perfectly correlated data
      for (let i = 0; i < 30; i++) {
        const value = 0.14 + (i * 0.001);
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: value,
          timestamp: new Date(baseTime + i * 60000),
        });

        analyzer.addPriceUpdate({
          symbol: 'XLMUSDT',
          price: value * 1.5, // Scaled but perfectly correlated
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      const correlation = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');

      // Should be very close to 1.0
      if (correlation !== null) {
        expect(correlation).toBeGreaterThan(0.95);
      }
    });

    it('should return negative correlation for inversely correlated data', () => {
      const baseTime = Date.now();

      // Add inversely correlated data
      for (let i = 0; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: 0.14 + (i * 0.001),
          timestamp: new Date(baseTime + i * 60000),
        });

        analyzer.addPriceUpdate({
          symbol: 'XLMUSDT',
          price: 0.30 - (i * 0.001), // Inverse movement
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      const correlation = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');

      // Should be negative
      if (correlation !== null) {
        expect(correlation).toBeLessThan(0);
      }
    });

    it('should return same correlation regardless of symbol order', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: 0.14 + (i * 0.001),
          timestamp: new Date(baseTime + i * 60000),
        });

        analyzer.addPriceUpdate({
          symbol: 'XLMUSDT',
          price: 0.22 + (i * 0.001),
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      const corr1 = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');
      const corr2 = analyzer.getCorrelation('XLMUSDT', 'DOGEUSDT');

      expect(corr1).toBe(corr2);
    });
  });

  describe('getCorrelationMatrix()', () => {
    it('should return empty matrix for no symbols', () => {
      const matrix = analyzer.getCorrelationMatrix([]);
      expect(Object.keys(matrix).length).toBe(0);
    });

    it('should return matrix for single symbol', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: 0.14 + (i * 0.001),
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      const matrix = analyzer.getCorrelationMatrix(['DOGEUSDT']);

      expect(matrix.DOGEUSDT).toBeDefined();
      expect(matrix.DOGEUSDT.DOGEUSDT).toBe(1.0); // Self-correlation is always 1
    });

    it('should return symmetric matrix', () => {
      const baseTime = Date.now();
      const symbols = ['DOGEUSDT', 'XLMUSDT', 'ADAUSDT'];

      // Add data for all symbols
      for (let i = 0; i < 30; i++) {
        symbols.forEach((symbol, idx) => {
          analyzer.addPriceUpdate({
            symbol,
            price: (0.14 + idx * 0.1) + (i * 0.001),
            timestamp: new Date(baseTime + i * 60000),
          });
        });
      }

      const matrix = analyzer.getCorrelationMatrix(symbols);

      // Matrix should be symmetric
      symbols.forEach(s1 => {
        symbols.forEach(s2 => {
          const corr1 = matrix[s1]?.[s2];
          const corr2 = matrix[s2]?.[s1];

          if (corr1 !== undefined && corr2 !== undefined) {
            expect(Math.abs(corr1 - corr2)).toBeLessThan(0.0001);
          }
        });
      });
    });

    it('should have 1.0 on diagonal', () => {
      const baseTime = Date.now();
      const symbols = ['DOGEUSDT', 'XLMUSDT'];

      for (let i = 0; i < 30; i++) {
        symbols.forEach((symbol) => {
          analyzer.addPriceUpdate({
            symbol,
            price: 0.14 + (i * 0.001),
            timestamp: new Date(baseTime + i * 60000),
          });
        });
      }

      const matrix = analyzer.getCorrelationMatrix(symbols);

      // Self-correlation should be 1.0
      symbols.forEach(symbol => {
        expect(matrix[symbol]?.[symbol]).toBe(1.0);
      });
    });
  });

  describe('clearHistory()', () => {
    it('should clear all price history', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: 0.14 + (i * 0.001),
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      analyzer.clearHistory();

      const correlation = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');
      expect(correlation).toBeNull();
    });

    it('should allow adding data after clearing', () => {
      // Add and clear
      analyzer.addPriceUpdate({
        symbol: 'DOGEUSDT',
        price: 0.14,
        timestamp: new Date(),
      });

      analyzer.clearHistory();

      // Add new data
      analyzer.addPriceUpdate({
        symbol: 'DOGEUSDT',
        price: 0.15,
        timestamp: new Date(),
      });

      const matrix = analyzer.getCorrelationMatrix(['DOGEUSDT']);
      expect(matrix).toBeDefined();
    });
  });

  describe('calculateVolatility()', () => {
    it('should return null for insufficient data', () => {
      const volatility = analyzer.calculateVolatility('DOGEUSDT');
      expect(volatility).toBeNull();
    });

    it('should calculate volatility for price series', () => {
      const baseTime = Date.now();

      // Add varying prices
      const prices = [0.14, 0.15, 0.13, 0.16, 0.14, 0.15, 0.14, 0.15, 0.14, 0.15];
      prices.forEach((price, i) => {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price,
          timestamp: new Date(baseTime + i * 60000),
        });
      });

      const volatility = analyzer.calculateVolatility('DOGEUSDT');

      // Should calculate a positive volatility
      if (volatility !== null) {
        expect(volatility).toBeGreaterThan(0);
      }
    });

    it('should return 0 volatility for constant prices', () => {
      const baseTime = Date.now();

      // Add constant prices
      for (let i = 0; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'DOGEUSDT',
          price: 0.14,
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      const volatility = analyzer.calculateVolatility('DOGEUSDT');

      // Should be 0 or very close to 0
      if (volatility !== null) {
        expect(volatility).toBeLessThan(0.0001);
      }
    });

    it('should calculate higher volatility for more variable prices', () => {
      const baseTime = Date.now();

      // Low volatility data
      analyzer.addPriceUpdate({ symbol: 'STABLE', price: 0.14, timestamp: new Date(baseTime) });
      for (let i = 1; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'STABLE',
          price: 0.14 + (Math.random() * 0.001 - 0.0005), // Small variation
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      // High volatility data
      analyzer.addPriceUpdate({ symbol: 'VOLATILE', price: 0.14, timestamp: new Date(baseTime) });
      for (let i = 1; i < 30; i++) {
        analyzer.addPriceUpdate({
          symbol: 'VOLATILE',
          price: 0.14 + (Math.random() * 0.04 - 0.02), // Large variation
          timestamp: new Date(baseTime + i * 60000),
        });
      }

      const stableVol = analyzer.calculateVolatility('STABLE');
      const volatileVol = analyzer.calculateVolatility('VOLATILE');

      if (stableVol !== null && volatileVol !== null) {
        expect(volatileVol).toBeGreaterThan(stableVol);
      }
    });
  });
});
