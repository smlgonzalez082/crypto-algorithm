/**
 * Price Simulator for Testing Grid Trading Bot
 * Generates realistic price movements to trigger grid trades in simulation mode
 */

import { createLogger } from "../utils/logger.js";
import { tradingDb } from "../models/database.js";

const logger = createLogger("price-simulator");

export interface SimulatorConfig {
  volatility: number; // Annualized volatility (e.g., 0.5 = 50%)
  drift: number; // Annual drift/trend (e.g., 0.1 = 10% annual growth)
  updateInterval: number; // Milliseconds between price updates
  enabled: boolean;
}

interface PriceState {
  symbol: string;
  currentPrice: number;
  lastUpdate: Date;
}

/**
 * Price Simulator using Geometric Brownian Motion
 * Generates realistic price movements for testing
 */
export class PriceSimulator {
  private config: SimulatorConfig;
  private priceStates: Map<string, PriceState> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private priceUpdateCallback:
    | ((symbol: string, price: number) => void)
    | null = null;

  constructor(config?: Partial<SimulatorConfig>) {
    this.config = {
      volatility: 0.5, // 50% annualized volatility (crypto-like)
      drift: 0.0, // No drift by default (mean-reverting)
      updateInterval: 5000, // Update every 5 seconds
      enabled: false,
      ...config,
    };

    logger.info(
      {
        volatility: `${(this.config.volatility * 100).toFixed(0)}%`,
        drift: `${(this.config.drift * 100).toFixed(0)}%`,
        interval: `${this.config.updateInterval / 1000}s`,
      },
      "Price simulator initialized",
    );
  }

  /**
   * Register a callback for price updates
   */
  onPriceUpdate(callback: (symbol: string, price: number) => void): void {
    this.priceUpdateCallback = callback;
  }

  /**
   * Initialize price for a symbol
   */
  initializePrice(symbol: string, startPrice: number): void {
    this.priceStates.set(symbol, {
      symbol,
      currentPrice: startPrice,
      lastUpdate: new Date(),
    });

    logger.info(
      { symbol, startPrice: startPrice.toFixed(6) },
      "Price initialized for simulation",
    );
  }

  /**
   * Start simulating price movements
   */
  start(): void {
    if (!this.config.enabled) {
      logger.warn("Price simulator is disabled");
      return;
    }

    if (this.intervalId) {
      logger.warn("Price simulator already running");
      return;
    }

    logger.info("Starting price simulation...");

    this.intervalId = setInterval(() => {
      this.updateAllPrices();
    }, this.config.updateInterval);
  }

  /**
   * Stop simulating price movements
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Price simulation stopped");
    }
  }

  /**
   * Update prices for all symbols
   */
  private updateAllPrices(): void {
    for (const [symbol, state] of this.priceStates) {
      const newPrice = this.generateNextPrice(state.currentPrice);

      // Update state
      state.currentPrice = newPrice;
      state.lastUpdate = new Date();

      // Save to database for analytics
      tradingDb.savePricePoint(symbol, newPrice);

      // Notify callback (this will trigger grid bot checks)
      if (this.priceUpdateCallback) {
        this.priceUpdateCallback(symbol, newPrice);
      }

      logger.debug({ symbol, price: newPrice.toFixed(6) }, "Price updated");
    }
  }

  /**
   * Generate next price using Geometric Brownian Motion
   * dS = μ * S * dt + σ * S * dW
   * where:
   *   S = current price
   *   μ = drift (annual)
   *   σ = volatility (annual)
   *   dt = time step
   *   dW = random Wiener process increment
   */
  private generateNextPrice(currentPrice: number): number {
    // Time step in years
    const dt = this.config.updateInterval / (1000 * 60 * 60 * 24 * 365);

    // Random component (standard normal)
    const dW = this.randomNormal(0, 1);

    // Geometric Brownian Motion
    const drift = this.config.drift * dt;
    const diffusion = this.config.volatility * Math.sqrt(dt) * dW;

    // Calculate price change ratio
    const priceChange = Math.exp(drift + diffusion);

    // Apply to current price
    const newPrice = currentPrice * priceChange;

    return newPrice;
  }

  /**
   * Generate random number from normal distribution
   * Using Box-Muller transform
   */
  private randomNormal(mean: number, stdDev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();

    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    return z0 * stdDev + mean;
  }

  /**
   * Get current simulated price for a symbol
   */
  getCurrentPrice(symbol: string): number | null {
    return this.priceStates.get(symbol)?.currentPrice ?? null;
  }

  /**
   * Manually trigger a price update (useful for testing)
   */
  triggerUpdate(): void {
    this.updateAllPrices();
  }

  /**
   * Add volatility spike (simulate market event)
   */
  addVolatilitySpike(multiplier: number = 2, duration: number = 60000): void {
    const originalVolatility = this.config.volatility;
    this.config.volatility *= multiplier;

    logger.info(
      {
        newVolatility: `${(this.config.volatility * 100).toFixed(0)}%`,
        duration: `${duration / 1000}s`,
      },
      "Volatility spike triggered",
    );

    setTimeout(() => {
      this.config.volatility = originalVolatility;
      logger.info(
        { volatility: `${(originalVolatility * 100).toFixed(0)}%` },
        "Volatility normalized",
      );
    }, duration);
  }

  /**
   * Set price trend (positive = uptrend, negative = downtrend)
   */
  setTrend(annualDrift: number, duration?: number): void {
    const originalDrift = this.config.drift;
    this.config.drift = annualDrift;

    logger.info(
      { trend: `${(annualDrift * 100).toFixed(0)}%/year` },
      "Price trend updated",
    );

    if (duration) {
      setTimeout(() => {
        this.config.drift = originalDrift;
        logger.info("Price trend reset to original");
      }, duration);
    }
  }

  /**
   * Get simulator status
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      running: this.intervalId !== null,
      activePairs: this.priceStates.size,
      config: this.config,
      prices: Array.from(this.priceStates.values()).map((state) => ({
        symbol: state.symbol,
        price: state.currentPrice,
        lastUpdate: state.lastUpdate,
      })),
    };
  }
}

// Singleton instance
export const priceSimulator = new PriceSimulator({
  enabled: process.env.SIMULATION_MODE === "true",
  volatility: parseFloat(process.env.SIM_VOLATILITY || "0.5"),
  drift: parseFloat(process.env.SIM_DRIFT || "0.0"),
  updateInterval: parseInt(process.env.SIM_UPDATE_INTERVAL || "5000"),
});
