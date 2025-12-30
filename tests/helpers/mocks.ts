/**
 * Test Mocks and Helpers
 * Centralized mocks for all tests
 */

import { jest } from '@jest/globals';
import type { BinanceClient } from '../../src/exchange/binance.js';
import type { Order, Balance, Ticker } from '../../src/types/index.js';

/**
 * Mock Binance Client
 */
export function createMockBinanceClient(): jest.Mocked<BinanceClient> {
  return {
    placeOrder: jest.fn().mockResolvedValue({
      orderId: '12345',
      symbol: 'DOGEUSDT',
      side: 'BUY',
      type: 'LIMIT',
      status: 'NEW',
      price: 0.14,
      quantity: 100,
      executedQty: 0,
      timeInForce: 'GTC',
      timestamp: Date.now(),
    } as Order),

    cancelOrder: jest.fn().mockResolvedValue({
      orderId: '12345',
      symbol: 'DOGEUSDT',
      side: 'BUY',
      type: 'LIMIT',
      status: 'CANCELED',
      price: 0.14,
      quantity: 100,
      executedQty: 0,
      timeInForce: 'GTC',
      timestamp: Date.now(),
    } as Order),

    getOrder: jest.fn().mockResolvedValue({
      orderId: '12345',
      symbol: 'DOGEUSDT',
      side: 'BUY',
      type: 'LIMIT',
      status: 'FILLED',
      price: 0.14,
      quantity: 100,
      executedQty: 100,
      timeInForce: 'GTC',
      timestamp: Date.now(),
    } as Order),

    getOpenOrders: jest.fn().mockResolvedValue([]),

    getBalances: jest.fn().mockResolvedValue([
      { asset: 'USDT', free: 1000, locked: 0 },
      { asset: 'DOGE', free: 0, locked: 0 },
    ] as Balance[]),

    getTicker: jest.fn().mockResolvedValue({
      symbol: 'DOGEUSDT',
      price: 0.14,
      priceChange: 0.01,
      priceChangePercent: 7.69,
      high: 0.15,
      low: 0.13,
      volume: 1000000,
      timestamp: Date.now(),
    } as Ticker),

    getTrades: jest.fn().mockResolvedValue([]),

    testConnectivity: jest.fn().mockResolvedValue(true),

    getAccountInfo: jest.fn().mockResolvedValue({
      balances: [
        { asset: 'USDT', free: 1000, locked: 0 },
        { asset: 'DOGE', free: 0, locked: 0 },
      ],
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
    }),
  } as unknown as jest.Mocked<BinanceClient>;
}

/**
 * Mock Database
 */
export function createMockDatabase() {
  return {
    saveTrade: jest.fn(),
    getTrades: jest.fn().mockReturnValue([]),
    saveGridState: jest.fn(),
    getGridState: jest.fn().mockReturnValue(null),
    deleteGridState: jest.fn(),
    savePairState: jest.fn(),
    getPairState: jest.fn().mockReturnValue(null),
    getAllPairStates: jest.fn().mockReturnValue([]),
    savePortfolioSnapshot: jest.fn(),
    getPortfolioSnapshots: jest.fn().mockReturnValue([]),
    savePricePoint: jest.fn(),
    getPriceHistory: jest.fn().mockReturnValue([]),
    getLatestPrice: jest.fn().mockReturnValue(null),
    cleanup: jest.fn(),
    close: jest.fn(),
  };
}

/**
 * Mock Logger
 */
export function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };
}

/**
 * Mock Price Data
 */
export function createMockPriceHistory(count: number, basePrice: number, volatility: number = 0.02) {
  const prices: Array<{ timestamp: number; price: number }> = [];
  let currentPrice = basePrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility;
    currentPrice = currentPrice * (1 + change);
    prices.push({
      timestamp: Date.now() - (count - i) * 60000, // 1 minute intervals
      price: currentPrice,
    });
  }

  return prices;
}

/**
 * Mock Trade Data
 */
export function createMockTrade(overrides?: Partial<{
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  realizedPnl: number;
  executedAt: Date;
}>) {
  return {
    symbol: overrides?.symbol || 'DOGEUSDT',
    side: overrides?.side || 'BUY',
    price: overrides?.price || 0.14,
    quantity: overrides?.quantity || 100,
    realizedPnl: overrides?.realizedPnl || 0,
    executedAt: overrides?.executedAt || new Date(),
  };
}

/**
 * Wait for promises to resolve
 */
export function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Sleep for testing
 */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
