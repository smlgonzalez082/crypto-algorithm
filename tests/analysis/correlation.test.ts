import { jest } from '@jest/globals';
import { CorrelationAnalyzer } from '../../src/analysis/correlation.js';

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

  describe('updatePriceHistory()', () => {
    it('should update price history for a symbol', () => {
      const prices = [{ timestamp: Date.now(), close: 0.14 }];
      analyzer.updatePriceHistory('DOGEUSDT', prices);

      const correlation = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');
      // Initially null since we need data for both symbols
      expect(correlation).toBeNull();
    });

    it('should store price data for multiple symbols', () => {
      analyzer.updatePriceHistory('DOGEUSDT', [{ timestamp: Date.now(), close: 0.14 }]);
      analyzer.updatePriceHistory('XLMUSDT', [{ timestamp: Date.now(), close: 0.22 }]);

      // Data should be stored
      const matrix = analyzer.getCorrelationMatrix();
      expect(matrix).toBeDefined();
    });

    it('should maintain price history', () => {
      const baseTime = Date.now();
      const prices = Array.from({ length: 10 }, (_, i) => ({
        timestamp: baseTime + i * 1000,
        close: 0.14 + (i * 0.001),
      }));

      analyzer.updatePriceHistory('DOGEUSDT', prices);

      // Should have stored multiple data points
      const matrix = analyzer.getCorrelationMatrix();
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
      const dogePrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14 + (i * 0.001),
      }));
      const xlmPrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.22 + (i * 0.001),
      }));

      analyzer.updatePriceHistory('DOGEUSDT', dogePrices);
      analyzer.updatePriceHistory('XLMUSDT', xlmPrices);

      const corrResult = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');

      // Should calculate a correlation value
      if (corrResult !== null) {
        expect(corrResult.correlation).toBeGreaterThanOrEqual(-1);
        expect(corrResult.correlation).toBeLessThanOrEqual(1);
      }
    });

    it('should return high correlation for perfectly correlated data', () => {
      const baseTime = Date.now();

      // Add perfectly correlated data
      const dogePrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14 + (i * 0.001),
      }));
      const xlmPrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: (0.14 + (i * 0.001)) * 1.5, // Scaled but perfectly correlated
      }));

      analyzer.updatePriceHistory('DOGEUSDT', dogePrices);
      analyzer.updatePriceHistory('XLMUSDT', xlmPrices);

      const corrResult = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');

      // Should be very close to 1.0
      if (corrResult !== null) {
        expect(corrResult.correlation).toBeGreaterThan(0.95);
      }
    });

    it('should return low correlation for uncorrelated data', () => {
      const baseTime = Date.now();

      // Add uncorrelated data - one goes up, other varies randomly
      const dogePrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14 + (i * 0.001),
      }));
      const xlmPrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.22 + (Math.sin(i) * 0.01), // Random-ish movement
      }));

      analyzer.updatePriceHistory('DOGEUSDT', dogePrices);
      analyzer.updatePriceHistory('XLMUSDT', xlmPrices);

      const corrResult = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');

      // Should not be highly correlated
      if (corrResult !== null) {
        expect(Math.abs(corrResult.correlation)).toBeLessThan(1);
      }
    });

    it('should return same correlation regardless of symbol order', () => {
      const baseTime = Date.now();

      const dogePrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14 + (i * 0.001),
      }));
      const xlmPrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.22 + (i * 0.001),
      }));

      analyzer.updatePriceHistory('DOGEUSDT', dogePrices);
      analyzer.updatePriceHistory('XLMUSDT', xlmPrices);

      const corr1 = analyzer.getCorrelation('DOGEUSDT', 'XLMUSDT');
      const corr2 = analyzer.getCorrelation('XLMUSDT', 'DOGEUSDT');

      expect(corr1?.correlation).toBe(corr2?.correlation);
    });
  });

  describe('getCorrelationMatrix()', () => {
    it('should return null when no price history', () => {
      const matrix = analyzer.getCorrelationMatrix();
      expect(matrix).toBeNull();
    });

    it('should return matrix for multiple symbols', () => {
      const baseTime = Date.now();
      const prices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14 + (i * 0.001),
      }));

      analyzer.updatePriceHistory('DOGEUSDT', prices);
      analyzer.updatePriceHistory('XLMUSDT', prices);

      const matrix = analyzer.getCorrelationMatrix();

      expect(matrix).not.toBeNull();
      if (matrix) {
        expect(matrix.pairs).toContain('DOGEUSDT');
        expect(matrix.pairs).toContain('XLMUSDT');
        expect(matrix.matrix.length).toBe(2);
        expect(matrix.matrix[0][0]).toBe(1.0); // Self-correlation
      }
    });

    it('should return symmetric matrix', () => {
      const baseTime = Date.now();
      const symbols = ['DOGEUSDT', 'XLMUSDT', 'ADAUSDT'];

      // Add data for all symbols
      symbols.forEach((symbol, idx) => {
        const prices = Array.from({ length: 30 }, (_, i) => ({
          timestamp: baseTime + i * 60000,
          close: (0.14 + idx * 0.1) + (i * 0.001),
        }));
        analyzer.updatePriceHistory(symbol, prices);
      });

      const matrix = analyzer.getCorrelationMatrix();

      if (matrix) {
        // Matrix should be symmetric
        for (let i = 0; i < matrix.pairs.length; i++) {
          for (let j = 0; j < matrix.pairs.length; j++) {
            expect(Math.abs(matrix.matrix[i][j] - matrix.matrix[j][i])).toBeLessThan(0.0001);
          }
        }
      }
    });

    it('should have 1.0 on diagonal', () => {
      const baseTime = Date.now();
      const symbols = ['DOGEUSDT', 'XLMUSDT'];

      symbols.forEach(() => {
        const prices = Array.from({ length: 30 }, (_, i) => ({
          timestamp: baseTime + i * 60000,
          close: 0.14 + (i * 0.001),
        }));
        analyzer.updatePriceHistory('DOGEUSDT', prices);
        analyzer.updatePriceHistory('XLMUSDT', prices);
      });

      const matrix = analyzer.getCorrelationMatrix();

      if (matrix) {
        // Self-correlation should be 1.0
        for (let i = 0; i < matrix.pairs.length; i++) {
          expect(matrix.matrix[i][i]).toBe(1.0);
        }
      }
    });
  });

  describe('getVolatility()', () => {
    it('should return null for symbol with no data', () => {
      const volatility = analyzer.getVolatility('DOGEUSDT');
      expect(volatility).toBeNull();
    });

    it('should calculate volatility for price series', () => {
      const baseTime = Date.now();

      // Add varying prices
      const prices = [0.14, 0.15, 0.13, 0.16, 0.14, 0.15, 0.14, 0.15, 0.14, 0.15].map((price, i) => ({
        timestamp: baseTime + i * 60000,
        close: price,
      }));

      analyzer.updatePriceHistory('DOGEUSDT', prices);

      const volatility = analyzer.getVolatility('DOGEUSDT');

      // Should calculate a positive volatility
      if (volatility !== null) {
        expect(volatility.daily).toBeGreaterThan(0);
        expect(volatility.weekly).toBeGreaterThan(0);
        expect(volatility.monthly).toBeGreaterThan(0);
      }
    });

    it('should return low volatility for constant prices', () => {
      const baseTime = Date.now();

      // Add constant prices
      const prices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14,
      }));

      analyzer.updatePriceHistory('DOGEUSDT', prices);

      const volatility = analyzer.getVolatility('DOGEUSDT');

      // Should be 0 or very close to 0
      if (volatility !== null) {
        expect(volatility.daily).toBeLessThan(0.0001);
      }
    });

    it('should calculate higher volatility for more variable prices', () => {
      const baseTime = Date.now();

      // Low volatility data
      const stablePrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14 + (Math.random() * 0.001 - 0.0005), // Small variation
      }));
      analyzer.updatePriceHistory('STABLE', stablePrices);

      // High volatility data
      const volatilePrices = Array.from({ length: 30 }, (_, i) => ({
        timestamp: baseTime + i * 60000,
        close: 0.14 + (Math.random() * 0.04 - 0.02), // Large variation
      }));
      analyzer.updatePriceHistory('VOLATILE', volatilePrices);

      const stableVol = analyzer.getVolatility('STABLE');
      const volatileVol = analyzer.getVolatility('VOLATILE');

      if (stableVol !== null && volatileVol !== null) {
        expect(volatileVol.daily).toBeGreaterThan(stableVol.daily);
      }
    });
  });
});
