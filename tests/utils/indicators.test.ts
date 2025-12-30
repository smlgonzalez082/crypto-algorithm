/**
 * Technical Indicators Tests
 */

import {
  calculateSMA,
  calculateEMA,
  calculateEMAArray,
  calculateATR,
  pricesToBars,
  detectTrend,
  calculateDynamicGridSpacing,
  calculateMinProfitableSpacing,
  type PriceBar,
} from '../../src/utils/indicators.js';

describe('Technical Indicators', () => {
  describe('calculateSMA', () => {
    it('should calculate simple moving average correctly', () => {
      const prices = [10, 20, 30, 40, 50];
      const sma = calculateSMA(prices, 5);

      expect(sma).toBe(30); // (10 + 20 + 30 + 40 + 50) / 5
    });

    it('should use only last N prices', () => {
      const prices = [10, 20, 30, 40, 50, 60];
      const sma = calculateSMA(prices, 3);

      expect(sma).toBe(50); // (40 + 50 + 60) / 3
    });

    it('should throw error with insufficient data', () => {
      const prices = [10, 20];

      expect(() => calculateSMA(prices, 5)).toThrow('Not enough data');
    });

    it('should handle single value period', () => {
      const prices = [42];
      const sma = calculateSMA(prices, 1);

      expect(sma).toBe(42);
    });
  });

  describe('calculateEMA', () => {
    it('should calculate exponential moving average', () => {
      const prices = [10, 20, 30, 40, 50];
      const ema = calculateEMA(prices, 5);

      expect(typeof ema).toBe('number');
      expect(ema).toBeGreaterThan(0);
      expect(ema).toBeLessThan(100);
    });

    it('should give more weight to recent prices', () => {
      const prices1 = [10, 10, 10, 10, 50]; // Recent spike
      const prices2 = [50, 10, 10, 10, 10]; // Old spike

      const ema1 = calculateEMA(prices1, 5);
      const ema2 = calculateEMA(prices2, 5);

      // EMA1 should be higher due to recent spike
      expect(ema1).toBeGreaterThan(ema2);
    });

    it('should throw error with insufficient data', () => {
      const prices = [10, 20];

      expect(() => calculateEMA(prices, 5)).toThrow('Not enough data');
    });
  });

  describe('calculateEMAArray', () => {
    it('should calculate EMA array', () => {
      const prices = [10, 20, 30, 40, 50, 60, 70];
      const emaArray = calculateEMAArray(prices, 3);

      expect(Array.isArray(emaArray)).toBe(true);
      expect(emaArray.length).toBeGreaterThan(0);
      expect(emaArray.length).toBe(prices.length - 3 + 1);
    });

    it('should have increasing EMA for uptrend', () => {
      const prices = [10, 20, 30, 40, 50];
      const emaArray = calculateEMAArray(prices, 3);

      // EMAs should generally increase for uptrend
      expect(emaArray[emaArray.length - 1]).toBeGreaterThan(emaArray[0]);
    });

    it('should throw error with insufficient data', () => {
      const prices = [10, 20];

      expect(() => calculateEMAArray(prices, 5)).toThrow('Not enough data');
    });
  });

  describe('calculateATR', () => {
    function createBar(high: number, low: number, close: number, timestamp: number = Date.now()): PriceBar {
      return {
        timestamp,
        open: (high + low) / 2,
        high,
        low,
        close,
        volume: 1000,
      };
    }

    it('should calculate average true range', () => {
      const bars: PriceBar[] = [
        createBar(50, 45, 48),
        createBar(52, 48, 51),
        createBar(55, 50, 53),
        createBar(54, 51, 52),
        createBar(56, 52, 55),
        createBar(58, 54, 57),
        createBar(60, 56, 58),
        createBar(62, 57, 60),
        createBar(65, 60, 63),
        createBar(64, 60, 62),
        createBar(66, 62, 65),
        createBar(68, 64, 66),
        createBar(70, 65, 68),
        createBar(72, 68, 70),
        createBar(75, 70, 73),
      ];

      const atr = calculateATR(bars, 14);

      expect(typeof atr).toBe('number');
      expect(atr).toBeGreaterThan(0);
    });

    it('should return higher ATR for volatile prices', () => {
      const volatileBars: PriceBar[] = [];
      const stableBars: PriceBar[] = [];

      for (let i = 0; i < 20; i++) {
        volatileBars.push(createBar(50 + Math.random() * 20, 40 + Math.random() * 10, 45 + Math.random() * 15));
        stableBars.push(createBar(50 + Math.random() * 2, 49 + Math.random() * 1, 49.5 + Math.random() * 0.5));
      }

      const volatileATR = calculateATR(volatileBars, 14);
      const stableATR = calculateATR(stableBars, 14);

      expect(volatileATR).toBeGreaterThan(stableATR);
    });

    it('should throw error with insufficient bars', () => {
      const bars: PriceBar[] = [
        createBar(50, 45, 48),
        createBar(52, 48, 51),
      ];

      expect(() => calculateATR(bars, 14)).toThrow('Not enough data');
    });
  });

  describe('pricesToBars', () => {
    it('should convert prices to OHLC bars', () => {
      const prices = [100, 105, 102, 108, 110];
      const timestamps = [1000, 2000, 3000, 4000, 5000];

      const bars = pricesToBars(prices, timestamps);

      expect(Array.isArray(bars)).toBe(true);
      expect(bars.length).toBeGreaterThan(0);
      bars.forEach((bar) => {
        expect(bar).toHaveProperty('open');
        expect(bar).toHaveProperty('high');
        expect(bar).toHaveProperty('low');
        expect(bar).toHaveProperty('close');
        expect(bar).toHaveProperty('timestamp');
      });
    });

    it('should create bars with correct OHLC values', () => {
      const prices = [100, 105, 102, 108];
      const timestamps = [1000, 2000, 3000, 4000];

      const bars = pricesToBars(prices, timestamps);

      // Each bar should have sensible values
      bars.forEach((bar) => {
        expect(bar.high).toBeGreaterThanOrEqual(bar.low);
        expect(bar.open).toBeGreaterThanOrEqual(bar.low);
        expect(bar.open).toBeLessThanOrEqual(bar.high);
        expect(bar.close).toBeGreaterThanOrEqual(bar.low);
        expect(bar.close).toBeLessThanOrEqual(bar.high);
      });
    });
  });

  describe('detectTrend', () => {
    it('should detect uptrend', () => {
      const prices = [100, 105, 110, 115, 120, 125, 130, 135, 140, 145,
                      150, 155, 160, 165, 170, 175, 180, 185, 190, 195,
                      200, 205, 210, 215, 220, 225, 230, 235, 240, 245,
                      250, 255, 260, 265, 270, 275, 280, 285, 290, 295,
                      300, 305, 310, 315, 320, 325, 330, 335, 340, 345,
                      350, 355, 360, 365, 370];
      const timestamps = prices.map((_, i) => i * 60000);
      const bars = pricesToBars(prices, timestamps);

      const trend = detectTrend(prices, 20, 50, 25, bars);

      expect(trend.direction).toBe('UP');
      expect(trend.strength).toBeGreaterThan(0);
    });

    it('should detect downtrend', () => {
      const prices = [370, 365, 360, 355, 350, 345, 340, 335, 330, 325,
                      320, 315, 310, 305, 300, 295, 290, 285, 280, 275,
                      270, 265, 260, 255, 250, 245, 240, 235, 230, 225,
                      220, 215, 210, 205, 200, 195, 190, 185, 180, 175,
                      170, 165, 160, 155, 150, 145, 140, 135, 130, 125,
                      120, 115, 110, 105, 100];
      const timestamps = prices.map((_, i) => i * 60000);
      const bars = pricesToBars(prices, timestamps);

      const trend = detectTrend(prices, 20, 50, 25, bars);

      expect(trend.direction).toBe('DOWN');
      expect(trend.strength).toBeGreaterThan(0);
    });

    it('should detect sideways/neutral trend', () => {
      const prices = [100, 102, 98, 101, 99, 103, 97, 102, 98, 101,
                      100, 102, 98, 101, 99, 103, 97, 102, 98, 101,
                      100, 102, 98, 101, 99, 103, 97, 102, 98, 101,
                      100, 102, 98, 101, 99, 103, 97, 102, 98, 101,
                      100, 102, 98, 101, 99, 103, 97, 102, 98, 101,
                      100, 102, 98, 101, 99];
      const timestamps = prices.map((_, i) => i * 60000);
      const bars = pricesToBars(prices, timestamps);

      const trend = detectTrend(prices, 20, 50, 25, bars);

      expect(trend.direction).toBe('SIDEWAYS');
    });

    it('should indicate whether to pause trading', () => {
      const prices = Array(55).fill(0).map((_, i) => 100 + i * 5); // Strong uptrend
      const timestamps = prices.map((_, i) => i * 60000);
      const bars = pricesToBars(prices, timestamps);

      const trend = detectTrend(prices, 20, 50, 25, bars);

      expect(trend).toHaveProperty('shouldPause');
      expect(typeof trend.shouldPause).toBe('boolean');
    });
  });

  describe('calculateDynamicGridSpacing', () => {
    function createBar(price: number, timestamp: number = Date.now()): PriceBar {
      return {
        timestamp,
        open: price * 0.99,
        high: price * 1.01,
        low: price * 0.98,
        close: price,
        volume: 1000,
      };
    }

    it('should calculate dynamic grid spacing based on ATR', () => {
      const bars = Array(20).fill(0).map((_, i) => createBar(100 + i));

      const spacing = calculateDynamicGridSpacing(bars, 14, 1.0);

      expect(spacing).toHaveProperty('suggestedSpacing');
      expect(spacing).toHaveProperty('atr');
      expect(spacing).toHaveProperty('minSpacing');
      expect(spacing).toHaveProperty('maxSpacing');
      expect(typeof spacing.suggestedSpacing).toBe('number');
      expect(spacing.suggestedSpacing).toBeGreaterThan(0);
    });

    it('should increase spacing for higher volatility', () => {
      const lowVolBars = Array(20).fill(0).map((_, i) => createBar(100 + i * 0.1));
      const highVolBars = Array(20).fill(0).map((_, i) => createBar(100 + i * 5));

      const lowVolSpacing = calculateDynamicGridSpacing(lowVolBars, 14, 1.0);
      const highVolSpacing = calculateDynamicGridSpacing(highVolBars, 14, 1.0);

      expect(highVolSpacing.suggestedSpacing).toBeGreaterThan(lowVolSpacing.suggestedSpacing);
    });

    it('should apply ATR multiplier correctly', () => {
      const bars = Array(20).fill(0).map((_, i) => createBar(100 + i));

      const spacing1x = calculateDynamicGridSpacing(bars, 14, 1.0);
      const spacing2x = calculateDynamicGridSpacing(bars, 14, 2.0);

      expect(spacing2x.suggestedSpacing).toBeCloseTo(spacing1x.suggestedSpacing * 2, 1);
    });
  });

  describe('calculateMinProfitableSpacing', () => {
    it('should calculate minimum profitable spacing', () => {
      const currentPrice = 0.14;
      const feePercent = 0.1;

      const minSpacing = calculateMinProfitableSpacing(currentPrice, feePercent);

      expect(typeof minSpacing).toBe('number');
      expect(minSpacing).toBeGreaterThan(0);
    });

    it('should increase with higher fees', () => {
      const currentPrice = 0.14;

      const lowFeeSpacing = calculateMinProfitableSpacing(currentPrice, 0.1);
      const highFeeSpacing = calculateMinProfitableSpacing(currentPrice, 0.5);

      expect(highFeeSpacing).toBeGreaterThan(lowFeeSpacing);
    });

    it('should scale with price', () => {
      const feePercent = 0.1;

      const lowPriceSpacing = calculateMinProfitableSpacing(0.10, feePercent);
      const highPriceSpacing = calculateMinProfitableSpacing(1.00, feePercent);

      expect(highPriceSpacing).toBeGreaterThan(lowPriceSpacing);
    });

    it('should ensure profitability after round-trip fees', () => {
      const currentPrice = 0.14;
      const feePercent = 0.1; // 0.1%

      const minSpacing = calculateMinProfitableSpacing(currentPrice, feePercent);

      // Buy at currentPrice, sell at currentPrice + minSpacing
      const buyPrice = currentPrice;
      const sellPrice = currentPrice + minSpacing;
      const buyFee = buyPrice * (feePercent / 100);
      const sellFee = sellPrice * (feePercent / 100);
      const profit = (sellPrice - buyPrice) - buyFee - sellFee;

      // Should be profitable
      expect(profit).toBeGreaterThan(0);
    });
  });
});
