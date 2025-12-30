/**
 * Technical Indicators for Grid Trading
 * Implements ATR, EMA, ADX, RSI, and other indicators for dynamic grid optimization
 */

export interface PriceBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) {
    throw new Error(`Not enough data: need ${period}, have ${prices.length}`);
  }

  const slice = prices.slice(-period);
  const sum = slice.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) {
    throw new Error(`Not enough data: need ${period}, have ${prices.length}`);
  }

  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate EMA array (for trend detection)
 */
export function calculateEMAArray(prices: number[], period: number): number[] {
  if (prices.length < period) {
    throw new Error(`Not enough data: need ${period}, have ${prices.length}`);
  }

  const multiplier = 2 / (period + 1);
  const emaArray: number[] = [];

  // Start with SMA for first value
  let ema = calculateSMA(prices.slice(0, period), period);
  emaArray.push(ema);

  // Calculate EMA for rest
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
    emaArray.push(ema);
  }

  return emaArray;
}

/**
 * Calculate Average True Range (ATR)
 * Used for dynamic grid spacing based on volatility
 */
export function calculateATR(bars: PriceBar[], period: number = 14): number {
  if (bars.length < period + 1) {
    throw new Error(`Not enough data: need ${period + 1}, have ${bars.length}`);
  }

  const trueRanges: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );

    trueRanges.push(tr);
  }

  // Calculate ATR as SMA of true ranges
  return calculateSMA(trueRanges.slice(-period), period);
}

/**
 * Calculate Average Directional Index (ADX)
 * Used for trend strength detection
 */
export function calculateADX(
  bars: PriceBar[],
  period: number = 14,
): { adx: number; plusDI: number; minusDI: number } {
  if (bars.length < period + 1) {
    throw new Error(`Not enough data: need ${period + 1}, have ${bars.length}`);
  }

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  // Calculate directional movement and true range
  for (let i = 1; i < bars.length; i++) {
    const highDiff = bars[i].high - bars[i - 1].high;
    const lowDiff = bars[i - 1].low - bars[i].low;

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    const trValue = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    tr.push(trValue);
  }

  // Calculate smoothed values
  const smoothedPlusDM = calculateSMA(plusDM.slice(-period), period);
  const smoothedMinusDM = calculateSMA(minusDM.slice(-period), period);
  const smoothedTR = calculateSMA(tr.slice(-period), period);

  // Calculate directional indicators
  const plusDI = (smoothedPlusDM / smoothedTR) * 100;
  const minusDI = (smoothedMinusDM / smoothedTR) * 100;

  // Calculate DX
  const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

  // For simplicity, return DX as ADX (proper ADX requires smoothing DX)
  return {
    adx: dx,
    plusDI,
    minusDI,
  };
}

/**
 * Calculate Relative Strength Index (RSI)
 * Used for overbought/oversold conditions
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) {
    throw new Error(
      `Not enough data: need ${period + 1}, have ${prices.length}`,
    );
  }

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const gains: number[] = [];
  const losses: number[] = [];

  for (const change of changes) {
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  const avgGain = calculateSMA(gains.slice(-period), period);
  const avgLoss = calculateSMA(losses.slice(-period), period);

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

/**
 * Detect if market is in a strong trend
 * Returns: 'uptrend', 'downtrend', 'sideways'
 */
export function detectTrend(
  prices: number[],
  ema20Period: number = 20,
  ema50Period: number = 50,
  adxThreshold: number = 25,
  bars?: PriceBar[],
): {
  direction: "uptrend" | "downtrend" | "sideways";
  strength: number;
  shouldPause: boolean;
} {
  if (prices.length < ema50Period) {
    return { direction: "sideways", strength: 0, shouldPause: false };
  }

  const currentPrice = prices[prices.length - 1];
  const ema20 = calculateEMA(prices, ema20Period);
  const ema50 = calculateEMA(prices, ema50Period);

  let adx = 0;
  if (bars && bars.length >= 15) {
    const adxData = calculateADX(bars);
    adx = adxData.adx;
  }

  // Determine trend direction
  let direction: "uptrend" | "downtrend" | "sideways" = "sideways";

  if (currentPrice > ema20 && ema20 > ema50) {
    direction = "uptrend";
  } else if (currentPrice < ema20 && ema20 < ema50) {
    direction = "downtrend";
  }

  // Determine if trend is strong enough to pause grid
  const shouldPause = adx > adxThreshold && direction !== "sideways";

  return {
    direction,
    strength: adx,
    shouldPause,
  };
}

/**
 * Calculate optimal grid spacing based on ATR
 */
export function calculateDynamicGridSpacing(
  bars: PriceBar[],
  atrPeriod: number = 14,
  atrMultiplier: number = 1.0,
): {
  atr: number;
  suggestedSpacing: number;
  volatilityLevel: "low" | "medium" | "high";
} {
  const atr = calculateATR(bars, atrPeriod);
  const currentPrice = bars[bars.length - 1].close;

  // Calculate ATR as percentage of current price
  const atrPercent = (atr / currentPrice) * 100;

  const suggestedSpacing = atr * atrMultiplier;

  let volatilityLevel: "low" | "medium" | "high" = "medium";
  if (atrPercent < 2) {
    volatilityLevel = "low";
  } else if (atrPercent > 5) {
    volatilityLevel = "high";
  }

  return {
    atr,
    suggestedSpacing,
    volatilityLevel,
  };
}

/**
 * Calculate Bollinger Bands
 * Can be used for dynamic grid range
 */
export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDev: number = 2,
): {
  middle: number;
  upper: number;
  lower: number;
  bandwidth: number;
} {
  if (prices.length < period) {
    throw new Error(`Not enough data: need ${period}, have ${prices.length}`);
  }

  const middle = calculateSMA(prices, period);
  const slice = prices.slice(-period);

  // Calculate standard deviation
  const squaredDiffs = slice.map((price) => Math.pow(price - middle, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
  const std = Math.sqrt(variance);

  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;
  const bandwidth = ((upper - lower) / middle) * 100;

  return {
    middle,
    upper,
    lower,
    bandwidth,
  };
}

/**
 * Convert price array to OHLC bars (for indicators that need them)
 */
export function pricesToBars(
  prices: number[],
  timestamps: number[],
): PriceBar[] {
  if (prices.length !== timestamps.length) {
    throw new Error("Prices and timestamps must have same length");
  }

  return prices.map((price, i) => ({
    timestamp: timestamps[i],
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
  }));
}

/**
 * Calculate trading fees for Binance.US
 */
export function calculateTradingFee(
  notional: number,
  feeRate: number = 0.001,
): number {
  return notional * feeRate;
}

/**
 * Calculate minimum profitable grid spacing
 * Grid spacing must be > 2x fee to be profitable
 */
export function calculateMinProfitableSpacing(
  currentPrice: number,
  feeRate: number = 0.001,
): number {
  // Minimum spacing = 2x fee (one buy + one sell)
  const minSpacingPercent = feeRate * 2 * 100;
  return currentPrice * (minSpacingPercent / 100);
}
