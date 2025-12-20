import { z } from 'zod';

// =============================================================================
// PAIR CONFIGURATION
// =============================================================================

export const PairConfigSchema = z.object({
  symbol: z.string(), // e.g., "DOGEUSDT"
  baseAsset: z.string(), // e.g., "DOGE"
  quoteAsset: z.string(), // e.g., "USDT"
  gridUpper: z.number().positive(),
  gridLower: z.number().positive(),
  gridCount: z.number().int().min(2).max(50),
  amountPerGrid: z.number().positive(),
  gridType: z.enum(['arithmetic', 'geometric']).default('arithmetic'),
  allocationPercent: z.number().min(0).max(100), // % of portfolio for this pair
  enabled: z.boolean().default(true),
});

export type PairConfig = z.infer<typeof PairConfigSchema>;

// =============================================================================
// CORRELATION DATA
// =============================================================================

export interface CorrelationMatrix {
  pairs: string[];
  matrix: number[][]; // Pearson correlation coefficients
  updatedAt: Date;
}

export interface PairCorrelation {
  pair1: string;
  pair2: string;
  correlation: number; // -1 to 1
  strength: 'negative' | 'weak' | 'moderate' | 'strong' | 'very_strong';
}

// =============================================================================
// PORTFOLIO RISK METRICS
// =============================================================================

export interface PortfolioRiskMetrics {
  // Overall portfolio metrics
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  dailyPnl: number;

  // Risk metrics
  portfolioVolatility: number; // Standard deviation of returns
  sharpeRatio: number; // Risk-adjusted return
  maxDrawdown: number;
  currentDrawdown: number;
  valueAtRisk: number; // VaR at 95% confidence

  // Diversification metrics
  effectiveDiversification: number; // 0-1, how well diversified
  concentrationRisk: number; // Herfindahl index
  correlationRisk: number; // Average pairwise correlation

  // Per-pair metrics
  pairMetrics: Map<string, PairRiskMetrics>;
}

export interface PairRiskMetrics {
  symbol: string;
  currentPrice: number;
  positionValue: number;
  positionPercent: number; // % of portfolio
  unrealizedPnl: number;
  realizedPnl: number;
  volatility: number;
  beta: number; // Correlation with portfolio
  contribution: number; // Contribution to portfolio risk
  gridEfficiency: number; // % of grids that triggered
}

// =============================================================================
// RISK MANAGEMENT STRATEGIES
// =============================================================================

export type RiskStrategy =
  | 'conservative'    // Lower leverage, wider stops, more cash
  | 'moderate'        // Balanced approach
  | 'aggressive';     // Higher allocation, tighter grids

export interface RiskLimitsConfig {
  // Position limits
  maxPositionPerPair: number; // Max % in single pair
  maxTotalExposure: number; // Max % of portfolio in positions
  minCashReserve: number; // Min % to keep as cash

  // Loss limits
  maxDailyLoss: number; // Max daily loss in $
  maxDailyLossPercent: number; // Max daily loss as %
  maxDrawdownPercent: number; // Max drawdown before stopping

  // Correlation limits
  maxCorrelation: number; // Max allowed correlation between pairs
  minDiversificationScore: number; // Minimum diversification

  // Grid limits
  maxOpenOrdersPerPair: number;
  maxTotalOpenOrders: number;

  // Circuit breakers
  pauseOnConsecutiveLosses: number;
  pauseOnVolatilitySpike: number; // Pause if volatility > X%
}

export const DEFAULT_RISK_LIMITS: Record<RiskStrategy, RiskLimitsConfig> = {
  conservative: {
    maxPositionPerPair: 30,
    maxTotalExposure: 60,
    minCashReserve: 40,
    maxDailyLoss: 50,
    maxDailyLossPercent: 2.5,
    maxDrawdownPercent: 10,
    maxCorrelation: 0.5,
    minDiversificationScore: 0.6,
    maxOpenOrdersPerPair: 10,
    maxTotalOpenOrders: 30,
    pauseOnConsecutiveLosses: 3,
    pauseOnVolatilitySpike: 15,
  },
  moderate: {
    maxPositionPerPair: 40,
    maxTotalExposure: 75,
    minCashReserve: 25,
    maxDailyLoss: 100,
    maxDailyLossPercent: 5,
    maxDrawdownPercent: 15,
    maxCorrelation: 0.65,
    minDiversificationScore: 0.5,
    maxOpenOrdersPerPair: 15,
    maxTotalOpenOrders: 50,
    pauseOnConsecutiveLosses: 5,
    pauseOnVolatilitySpike: 20,
  },
  aggressive: {
    maxPositionPerPair: 50,
    maxTotalExposure: 90,
    minCashReserve: 10,
    maxDailyLoss: 200,
    maxDailyLossPercent: 10,
    maxDrawdownPercent: 25,
    maxCorrelation: 0.8,
    minDiversificationScore: 0.3,
    maxOpenOrdersPerPair: 20,
    maxTotalOpenOrders: 80,
    pauseOnConsecutiveLosses: 7,
    pauseOnVolatilitySpike: 30,
  },
};

// =============================================================================
// PORTFOLIO STATE
// =============================================================================

export type PortfolioStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'paused'      // Temporarily paused due to risk limits
  | 'rebalancing' // Adjusting positions
  | 'stopping'
  | 'error';

export interface PortfolioState {
  status: PortfolioStatus;
  startTime: Date | null;
  totalCapital: number;
  availableCapital: number;
  allocatedCapital: number;
  pairs: Map<string, PairState>;
  riskMetrics: PortfolioRiskMetrics;
  correlationMatrix: CorrelationMatrix | null;
  lastRebalance: Date | null;
  pauseReason: string | null;
}

export interface PairState {
  config: PairConfig;
  status: 'stopped' | 'running' | 'paused' | 'error';
  currentPrice: number;
  gridLevels: GridLevelState[];
  activeOrders: number;
  positionSize: number; // In base asset
  positionValue: number; // In quote asset
  realizedPnl: number;
  unrealizedPnl: number;
  tradesCount: number;
  lastUpdate: Date;
}

export interface GridLevelState {
  level: number;
  price: number;
  buyOrderId: string | null;
  sellOrderId: string | null;
  status: 'empty' | 'buy_pending' | 'bought' | 'sell_pending' | 'sold';
  filledAt: Date | null;
}

// =============================================================================
// REBALANCING
// =============================================================================

export interface RebalanceAction {
  type: 'increase' | 'decrease' | 'close' | 'open';
  pair: string;
  currentAllocation: number;
  targetAllocation: number;
  reason: string;
}

export interface RebalanceResult {
  actions: RebalanceAction[];
  executedAt: Date;
  success: boolean;
  error?: string;
}

// =============================================================================
// HISTORICAL DATA FOR ANALYSIS
// =============================================================================

export interface PriceHistory {
  symbol: string;
  prices: { timestamp: number; close: number }[];
  returns: number[]; // Daily returns
}

export interface VolatilityData {
  symbol: string;
  daily: number;
  weekly: number;
  monthly: number;
  updatedAt: Date;
}
