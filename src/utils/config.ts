import dotenv from "dotenv";
import { z } from "zod";
import type { PairConfig } from "../types/portfolio.js";

dotenv.config();

const ConfigSchema = z.object({
  // Binance API
  binanceApiKey: z.string().default(""),
  binanceApiSecret: z.string().default(""),
  binanceTestnet: z.boolean().default(true),
  binanceUs: z.boolean().default(false),

  // Trading configuration (single pair - legacy)
  tradingPair: z.string().default("DOGEUSDT"),
  baseAsset: z.string().default("DOGE"),
  quoteAsset: z.string().default("USDT"),
  gridUpper: z.number().default(0.18), // ~28% above current DOGE price
  gridLower: z.number().default(0.1), // ~29% below current DOGE price
  gridCount: z.number().int().default(15),
  amountPerGrid: z.number().default(100), // 100 DOGE per grid (~$14)
  gridType: z.enum(["arithmetic", "geometric"]).default("arithmetic"),

  // Multi-pair portfolio settings
  portfolioMode: z.boolean().default(false),
  totalCapital: z.number().default(2000),
  riskStrategy: z
    .enum(["conservative", "moderate", "aggressive"])
    .default("moderate"),

  // Mode
  simulationMode: z.boolean().default(true),

  // Risk management
  maxPositionSize: z.number().default(0.1),
  stopLossPercent: z.number().default(5),
  dailyLossLimit: z.number().default(100),
  maxOpenOrders: z.number().int().default(50),

  // Web interface
  serverPort: z.number().int().default(3002),

  // AWS Cognito (optional - for production deployment)
  cognitoUserPoolId: z.string().default(""),
  cognitoClientId: z.string().default(""),
  cognitoRegion: z.string().default(""),
  cognitoDomain: z.string().default(""),

  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const rawConfig = {
    binanceApiKey: process.env.BINANCE_API_KEY,
    binanceApiSecret: process.env.BINANCE_API_SECRET,
    binanceTestnet: process.env.BINANCE_TESTNET?.toLowerCase() === "true",
    binanceUs: process.env.BINANCE_US?.toLowerCase() === "true",
    tradingPair: process.env.TRADING_PAIR,
    gridUpper: process.env.GRID_UPPER
      ? parseFloat(process.env.GRID_UPPER)
      : undefined,
    gridLower: process.env.GRID_LOWER
      ? parseFloat(process.env.GRID_LOWER)
      : undefined,
    gridCount: process.env.GRID_COUNT
      ? parseInt(process.env.GRID_COUNT, 10)
      : undefined,
    amountPerGrid: process.env.GRID_AMOUNT
      ? parseFloat(process.env.GRID_AMOUNT)
      : undefined,
    baseAsset: process.env.BASE_ASSET,
    quoteAsset: process.env.QUOTE_ASSET,
    gridType: process.env.GRID_TYPE as "arithmetic" | "geometric" | undefined,
    portfolioMode: process.env.PORTFOLIO_MODE?.toLowerCase() === "true",
    totalCapital: process.env.TOTAL_CAPITAL
      ? parseFloat(process.env.TOTAL_CAPITAL)
      : undefined,
    riskStrategy: process.env.RISK_STRATEGY as
      | "conservative"
      | "moderate"
      | "aggressive"
      | undefined,
    simulationMode: process.env.SIMULATION_MODE?.toLowerCase() !== "false",
    maxPositionSize: process.env.MAX_POSITION_SIZE
      ? parseFloat(process.env.MAX_POSITION_SIZE)
      : undefined,
    stopLossPercent: process.env.STOP_LOSS_PERCENT
      ? parseFloat(process.env.STOP_LOSS_PERCENT)
      : undefined,
    dailyLossLimit: process.env.DAILY_LOSS_LIMIT
      ? parseFloat(process.env.DAILY_LOSS_LIMIT)
      : undefined,
    maxOpenOrders: process.env.MAX_OPEN_ORDERS
      ? parseInt(process.env.MAX_OPEN_ORDERS, 10)
      : undefined,
    serverPort: process.env.SERVER_PORT
      ? parseInt(process.env.SERVER_PORT, 10)
      : undefined,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    cognitoClientId: process.env.COGNITO_CLIENT_ID,
    cognitoRegion: process.env.COGNITO_REGION,
    cognitoDomain: process.env.COGNITO_DOMAIN,
    logLevel: process.env.LOG_LEVEL?.toLowerCase() as
      | Config["logLevel"]
      | undefined,
  };

  // Filter out undefined values
  const filteredConfig = Object.fromEntries(
    Object.entries(rawConfig).filter(([_, v]) => v !== undefined),
  );

  return ConfigSchema.parse(filteredConfig);
}

export const config = loadConfig();

export function getGridLevels(): number[] {
  const levels: number[] = [];
  const { gridUpper, gridLower, gridCount, gridType } = config;

  if (gridType === "geometric") {
    const ratio = Math.pow(gridUpper / gridLower, 1 / gridCount);
    for (let i = 0; i <= gridCount; i++) {
      levels.push(gridLower * Math.pow(ratio, i));
    }
  } else {
    const spacing = (gridUpper - gridLower) / gridCount;
    for (let i = 0; i <= gridCount; i++) {
      levels.push(gridLower + spacing * i);
    }
  }

  return levels;
}

/**
 * Recommended pair configurations for Binance.US
 * Selected based on:
 * 1. Liquidity and trading volume
 * 2. Price volatility suitable for grid trading
 * 3. Low correlation between pairs for diversification
 * 4. Affordable entry price for $2000 budget
 */
export function getRecommendedPairs(): PairConfig[] {
  // Current prices (Dec 2025): DOGE ~$0.14, XLM ~$0.25
  return [
    // DOGE/USDT - High volatility, great for grid trading
    // Grid range: ~$0.10 to ~$0.18 (±30% from current price)
    {
      symbol: "DOGEUSDT",
      baseAsset: "DOGE",
      quoteAsset: "USDT",
      gridUpper: 0.18, // Upper bound ~28% above current price
      gridLower: 0.1, // Lower bound ~29% below current price
      gridCount: 7, // 8 grid levels (~$0.01 spacing) - prevents duplicates after tickSize rounding
      amountPerGrid: 100, // 100 DOGE per grid (~$14)
      gridType: "arithmetic",
      allocationPercent: 50, // 50% of portfolio
      enabled: true,
    },
    // XLM/USDT - Different use case (payments), lower correlation with DOGE
    // Grid range: ~$0.17 to ~$0.32 (±30% from current price)
    {
      symbol: "XLMUSDT",
      baseAsset: "XLM",
      quoteAsset: "USDT",
      gridUpper: 0.32, // Upper bound ~30% above current price
      gridLower: 0.17, // Lower bound ~31% below current price
      gridCount: 7, // 8 grid levels (~$0.02 spacing)
      amountPerGrid: 50, // 50 XLM per grid (~$12)
      gridType: "arithmetic",
      allocationPercent: 50, // 50% of portfolio
      enabled: true,
    },
  ];
}

/**
 * Alternative pair configurations for different risk appetites
 */
export function getAlternativePairs(): Record<string, PairConfig[]> {
  return {
    conservative: [
      // More established coins with slightly lower volatility
      {
        symbol: "ADAUSDT",
        baseAsset: "ADA",
        quoteAsset: "USDT",
        gridUpper: 1.2,
        gridLower: 0.6,
        gridCount: 12,
        amountPerGrid: 20,
        gridType: "arithmetic",
        allocationPercent: 50,
        enabled: true,
      },
      {
        symbol: "XLMUSDT",
        baseAsset: "XLM",
        quoteAsset: "USDT",
        gridUpper: 0.5,
        gridLower: 0.25,
        gridCount: 12,
        amountPerGrid: 50,
        gridType: "arithmetic",
        allocationPercent: 50,
        enabled: true,
      },
    ],
    aggressive: [
      // Higher volatility pairs for more trading opportunities
      {
        symbol: "DOGEUSDT",
        baseAsset: "DOGE",
        quoteAsset: "USDT",
        gridUpper: 0.5,
        gridLower: 0.2,
        gridCount: 20, // More grids
        amountPerGrid: 40,
        gridType: "geometric", // Geometric for volatile assets
        allocationPercent: 60,
        enabled: true,
      },
      {
        symbol: "SHIBUSDT",
        baseAsset: "SHIB",
        quoteAsset: "USDT",
        gridUpper: 0.000035,
        gridLower: 0.000015,
        gridCount: 20,
        amountPerGrid: 500000, // SHIB has tiny per-unit price
        gridType: "geometric",
        allocationPercent: 40,
        enabled: true,
      },
    ],
  };
}
