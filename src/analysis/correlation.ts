import { createLogger } from '../utils/logger.js';
import type {
  CorrelationMatrix,
  PairCorrelation,
  PriceHistory,
  VolatilityData,
} from '../types/portfolio.js';

const logger = createLogger('correlation');

/**
 * Calculates Pearson correlation coefficient between two arrays of returns
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) {
    return 0;
  }

  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Calculates daily returns from price data
 */
function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

/**
 * Calculates standard deviation (volatility)
 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Interprets correlation strength
 */
function interpretCorrelation(
  correlation: number
): 'negative' | 'weak' | 'moderate' | 'strong' | 'very_strong' {
  const abs = Math.abs(correlation);
  if (correlation < -0.3) return 'negative';
  if (abs < 0.3) return 'weak';
  if (abs < 0.5) return 'moderate';
  if (abs < 0.7) return 'strong';
  return 'very_strong';
}

export class CorrelationAnalyzer {
  private priceHistories: Map<string, PriceHistory> = new Map();
  private correlationCache: CorrelationMatrix | null = null;
  private volatilityCache: Map<string, VolatilityData> = new Map();

  /**
   * Updates price history for a symbol
   */
  updatePriceHistory(symbol: string, prices: { timestamp: number; close: number }[]): void {
    const returns = calculateReturns(prices.map((p) => p.close));
    this.priceHistories.set(symbol, { symbol, prices, returns });

    // Invalidate correlation cache
    this.correlationCache = null;

    // Update volatility
    this.updateVolatility(symbol, returns);
  }

  /**
   * Updates volatility data for a symbol
   */
  private updateVolatility(symbol: string, returns: number[]): void {
    // Annualize daily volatility (assuming 365 trading days for crypto)
    const dailyVol = standardDeviation(returns) * 100; // As percentage
    const weeklyVol = dailyVol * Math.sqrt(7);
    const monthlyVol = dailyVol * Math.sqrt(30);

    this.volatilityCache.set(symbol, {
      symbol,
      daily: dailyVol,
      weekly: weeklyVol,
      monthly: monthlyVol,
      updatedAt: new Date(),
    });
  }

  /**
   * Calculates correlation between two specific pairs
   */
  getCorrelation(symbol1: string, symbol2: string): PairCorrelation | null {
    const history1 = this.priceHistories.get(symbol1);
    const history2 = this.priceHistories.get(symbol2);

    if (!history1 || !history2) {
      logger.warn({ symbol1, symbol2 }, 'Missing price history for correlation calculation');
      return null;
    }

    // Align returns by using minimum length
    const minLen = Math.min(history1.returns.length, history2.returns.length);
    if (minLen < 10) {
      logger.warn({ symbol1, symbol2, minLen }, 'Insufficient data for correlation');
      return null;
    }

    const returns1 = history1.returns.slice(-minLen);
    const returns2 = history2.returns.slice(-minLen);

    const correlation = pearsonCorrelation(returns1, returns2);

    return {
      pair1: symbol1,
      pair2: symbol2,
      correlation,
      strength: interpretCorrelation(correlation),
    };
  }

  /**
   * Builds full correlation matrix for all tracked pairs
   */
  buildCorrelationMatrix(): CorrelationMatrix {
    const pairs = Array.from(this.priceHistories.keys());
    const n = pairs.length;
    const matrix: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1; // Perfect correlation with self
      for (let j = i + 1; j < n; j++) {
        const corr = this.getCorrelation(pairs[i], pairs[j]);
        const value = corr?.correlation ?? 0;
        matrix[i][j] = value;
        matrix[j][i] = value; // Symmetric
      }
    }

    this.correlationCache = {
      pairs,
      matrix,
      updatedAt: new Date(),
    };

    return this.correlationCache;
  }

  /**
   * Gets cached correlation matrix or builds new one
   */
  getCorrelationMatrix(): CorrelationMatrix | null {
    if (!this.correlationCache) {
      if (this.priceHistories.size >= 2) {
        return this.buildCorrelationMatrix();
      }
      return null;
    }
    return this.correlationCache;
  }

  /**
   * Gets volatility data for a symbol
   */
  getVolatility(symbol: string): VolatilityData | null {
    return this.volatilityCache.get(symbol) ?? null;
  }

  /**
   * Finds the least correlated pairs from a list
   * This is key for diversification
   */
  findLeastCorrelatedPairs(
    symbols: string[],
    maxCorrelation: number = 0.5
  ): { pair1: string; pair2: string; correlation: number }[] {
    const results: { pair1: string; pair2: string; correlation: number }[] = [];

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const corr = this.getCorrelation(symbols[i], symbols[j]);
        if (corr && Math.abs(corr.correlation) <= maxCorrelation) {
          results.push({
            pair1: symbols[i],
            pair2: symbols[j],
            correlation: corr.correlation,
          });
        }
      }
    }

    // Sort by absolute correlation (lowest first = best diversification)
    return results.sort((a, b) => Math.abs(a.correlation) - Math.abs(b.correlation));
  }

  /**
   * Calculates portfolio diversification score
   * Higher is better (0-1 scale)
   */
  calculateDiversificationScore(symbols: string[]): number {
    if (symbols.length < 2) return 0;

    const correlations: number[] = [];
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const corr = this.getCorrelation(symbols[i], symbols[j]);
        if (corr) {
          correlations.push(Math.abs(corr.correlation));
        }
      }
    }

    if (correlations.length === 0) return 0.5; // Neutral if no data

    const avgCorrelation = correlations.reduce((a, b) => a + b, 0) / correlations.length;

    // Convert to diversification score: 1 = perfectly uncorrelated, 0 = perfectly correlated
    return 1 - avgCorrelation;
  }

  /**
   * Suggests optimal allocation based on correlation and volatility
   * Uses inverse volatility weighting adjusted for correlation
   */
  suggestAllocation(
    symbols: string[],
    totalCapital: number
  ): Map<string, { allocation: number; reason: string }> {
    const allocations = new Map<string, { allocation: number; reason: string }>();

    if (symbols.length === 0) return allocations;
    if (symbols.length === 1) {
      allocations.set(symbols[0], {
        allocation: totalCapital,
        reason: 'Single asset - full allocation',
      });
      return allocations;
    }

    // Get volatilities
    const volatilities: { symbol: string; vol: number }[] = [];
    for (const symbol of symbols) {
      const volData = this.volatilityCache.get(symbol);
      volatilities.push({
        symbol,
        vol: volData?.daily ?? 5, // Default 5% if no data
      });
    }

    // Inverse volatility weighting
    // Lower volatility = higher weight (more stable)
    const inverseVols = volatilities.map((v) => ({
      symbol: v.symbol,
      invVol: 1 / v.vol,
    }));

    const totalInvVol = inverseVols.reduce((sum, v) => sum + v.invVol, 0);

    for (const { symbol, invVol } of inverseVols) {
      const weight = invVol / totalInvVol;
      const allocation = totalCapital * weight;
      const vol = volatilities.find((v) => v.symbol === symbol)?.vol ?? 0;

      allocations.set(symbol, {
        allocation: Math.round(allocation * 100) / 100,
        reason: `Volatility-weighted: ${vol.toFixed(1)}% daily vol`,
      });
    }

    return allocations;
  }

  /**
   * Checks if adding a new pair would hurt diversification
   */
  wouldHurtDiversification(
    currentPairs: string[],
    newPair: string,
    maxCorrelation: number = 0.7
  ): { wouldHurt: boolean; reason: string; correlations: PairCorrelation[] } {
    const correlations: PairCorrelation[] = [];

    for (const existing of currentPairs) {
      const corr = this.getCorrelation(existing, newPair);
      if (corr) {
        correlations.push(corr);
        if (Math.abs(corr.correlation) > maxCorrelation) {
          return {
            wouldHurt: true,
            reason: `High correlation (${corr.correlation.toFixed(2)}) with ${existing}`,
            correlations,
          };
        }
      }
    }

    return {
      wouldHurt: false,
      reason: 'Acceptable correlation levels',
      correlations,
    };
  }

  /**
   * Gets a summary report of all correlations
   */
  getCorrelationReport(): {
    matrix: CorrelationMatrix | null;
    summary: {
      avgCorrelation: number;
      maxCorrelation: { pair1: string; pair2: string; value: number } | null;
      minCorrelation: { pair1: string; pair2: string; value: number } | null;
      diversificationScore: number;
    };
  } {
    const matrix = this.getCorrelationMatrix();
    const pairs = Array.from(this.priceHistories.keys());

    if (!matrix || pairs.length < 2) {
      return {
        matrix,
        summary: {
          avgCorrelation: 0,
          maxCorrelation: null,
          minCorrelation: null,
          diversificationScore: 0,
        },
      };
    }

    let totalCorr = 0;
    let count = 0;
    let maxCorr = { pair1: '', pair2: '', value: -2 };
    let minCorr = { pair1: '', pair2: '', value: 2 };

    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const corr = matrix.matrix[i][j];
        totalCorr += Math.abs(corr);
        count++;

        if (corr > maxCorr.value) {
          maxCorr = { pair1: pairs[i], pair2: pairs[j], value: corr };
        }
        if (corr < minCorr.value) {
          minCorr = { pair1: pairs[i], pair2: pairs[j], value: corr };
        }
      }
    }

    return {
      matrix,
      summary: {
        avgCorrelation: count > 0 ? totalCorr / count : 0,
        maxCorrelation: maxCorr.value > -2 ? maxCorr : null,
        minCorrelation: minCorr.value < 2 ? minCorr : null,
        diversificationScore: this.calculateDiversificationScore(pairs),
      },
    };
  }
}

// Singleton instance
export const correlationAnalyzer = new CorrelationAnalyzer();
