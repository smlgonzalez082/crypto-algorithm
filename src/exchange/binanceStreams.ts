import Binance from 'binance';
import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import type { Order, OrderSide, OrderStatus } from '../types/index.js';

const logger = createLogger('binance-streams');

export interface TickerData {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

export interface TradeData {
  symbol: string;
  tradeId: string;
  price: number;
  quantity: number;
  buyerMaker: boolean;
  timestamp: number;
}

type TickerCallback = (data: TickerData) => void;
type TradeCallback = (data: TradeData) => void;
type OrderCallback = (order: Order) => void;
type ConnectionCallback = (connected: boolean) => void;

/**
 * BinanceStreamManager handles real-time WebSocket connections to Binance
 * for multiple trading pairs simultaneously.
 */
export class BinanceStreamManager {
  private wsClient: Binance.WebsocketClient | null = null;
  private subscribedSymbols: Set<string> = new Set();
  private tickerCallbacks: Map<string, TickerCallback[]> = new Map();
  private tradeCallbacks: Map<string, TradeCallback[]> = new Map();
  private orderCallbacks: OrderCallback[] = [];
  private connectionCallbacks: ConnectionCallback[] = [];
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private userStreamListenKey: string | null = null;
  private userStreamKeepAliveInterval: NodeJS.Timeout | null = null;
  private restClient: Binance.MainClient | null = null;

  constructor() {
    // Initialize REST client for listen key management
    this.initRestClient();
  }

  private initRestClient(): void {
    let baseUrl: string | undefined;
    if (config.binanceTestnet) {
      baseUrl = 'https://testnet.binance.vision';
    } else if (config.binanceUs) {
      baseUrl = 'https://api.binance.us';
    }

    this.restClient = new Binance.MainClient({
      api_key: config.binanceApiKey,
      api_secret: config.binanceApiSecret,
      baseUrl,
    });
  }

  /**
   * Connect to Binance WebSocket streams
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      logger.warn('Already connected to Binance streams');
      return;
    }

    try {
      let wsBaseUrl: string | undefined;
      if (config.binanceTestnet) {
        wsBaseUrl = 'wss://testnet.binance.vision';
      } else if (config.binanceUs) {
        wsBaseUrl = 'wss://stream.binance.us:9443';
      }

      this.wsClient = new Binance.WebsocketClient({
        api_key: config.binanceApiKey,
        api_secret: config.binanceApiSecret,
        beautify: true,
        wsUrl: wsBaseUrl,
      });

      this.setupEventHandlers();

      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.notifyConnectionStatus(true);

      logger.info({ binanceUs: config.binanceUs }, 'Connected to Binance WebSocket streams');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to Binance streams');
      this.handleReconnect();
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.wsClient) return;

    // Handle ticker updates (24hr rolling window)
    this.wsClient.on('formattedMessage', (data: unknown) => {
      this.handleMessage(data);
    });

    // Handle user data messages (order updates)
    this.wsClient.on('formattedUserDataMessage', (data: unknown) => {
      this.handleUserDataMessage(data);
    });

    // Handle connection open
    this.wsClient.on('open', (data: { wsKey: string }) => {
      logger.info({ wsKey: data.wsKey }, 'WebSocket connection opened');
    });

    // Handle errors
    this.wsClient.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
    });

    // Handle reconnection
    this.wsClient.on('reconnecting', (data: { wsKey: string }) => {
      logger.warn({ wsKey: data.wsKey }, 'WebSocket reconnecting');
      this.notifyConnectionStatus(false);
    });

    this.wsClient.on('reconnected', (data: { wsKey: string }) => {
      logger.info({ wsKey: data.wsKey }, 'WebSocket reconnected');
      this.notifyConnectionStatus(true);
    });

    // Handle close
    this.wsClient.on('close', () => {
      logger.warn('WebSocket connection closed');
      this.isConnected = false;
      this.notifyConnectionStatus(false);
    });
  }

  private handleMessage(data: unknown): void {
    const msg = data as {
      eventType?: string;
      symbol?: string;
      close?: string;
      lastPrice?: string;
      priceChange?: string;
      priceChangePercent?: string;
      high?: string;
      low?: string;
      volume?: string;
      eventTime?: number;
      // Trade data
      tradeId?: number;
      price?: string;
      quantity?: string;
      buyerMaker?: boolean;
    };

    // Handle 24hr ticker
    if (msg.eventType === '24hrTicker' && msg.symbol) {
      const tickerData: TickerData = {
        symbol: msg.symbol,
        price: parseFloat(msg.close || msg.lastPrice || '0'),
        priceChange: parseFloat(msg.priceChange || '0'),
        priceChangePercent: parseFloat(msg.priceChangePercent || '0'),
        high: parseFloat(msg.high || '0'),
        low: parseFloat(msg.low || '0'),
        volume: parseFloat(msg.volume || '0'),
        timestamp: msg.eventTime || Date.now(),
      };

      const callbacks = this.tickerCallbacks.get(msg.symbol) || [];
      for (const callback of callbacks) {
        try {
          callback(tickerData);
        } catch (error) {
          logger.error({ error, symbol: msg.symbol }, 'Error in ticker callback');
        }
      }
    }

    // Handle individual trades
    if (msg.eventType === 'trade' && msg.symbol) {
      const tradeData: TradeData = {
        symbol: msg.symbol,
        tradeId: String(msg.tradeId || ''),
        price: parseFloat(msg.price || '0'),
        quantity: parseFloat(msg.quantity || '0'),
        buyerMaker: msg.buyerMaker || false,
        timestamp: msg.eventTime || Date.now(),
      };

      const callbacks = this.tradeCallbacks.get(msg.symbol) || [];
      for (const callback of callbacks) {
        try {
          callback(tradeData);
        } catch (error) {
          logger.error({ error, symbol: msg.symbol }, 'Error in trade callback');
        }
      }
    }
  }

  private handleUserDataMessage(data: unknown): void {
    const msg = data as {
      eventType?: string;
      orderId?: number;
      newClientOrderId?: string;
      symbol?: string;
      side?: string;
      orderType?: string;
      price?: string;
      quantity?: string;
      lastFilledQuantity?: string;
      cumulativeFilledQuantity?: string;
      orderStatus?: string;
      eventTime?: number;
    };

    if (msg.eventType === 'executionReport') {
      const order: Order = {
        orderId: String(msg.orderId || ''),
        clientOrderId: msg.newClientOrderId,
        tradingPair: msg.symbol || '',
        side: (msg.side as OrderSide) || 'BUY',
        orderType: msg.orderType || 'LIMIT',
        price: parseFloat(msg.price || '0'),
        quantity: parseFloat(msg.quantity || '0'),
        filledQuantity: parseFloat(msg.cumulativeFilledQuantity || msg.lastFilledQuantity || '0'),
        status: (msg.orderStatus as OrderStatus) || 'NEW',
        gridLevel: this.extractGridLevel(msg.newClientOrderId || ''),
        createdAt: new Date(msg.eventTime || Date.now()),
      };

      logger.debug({ order }, 'Order update received via WebSocket');

      for (const callback of this.orderCallbacks) {
        try {
          callback(order);
        } catch (error) {
          logger.error({ error }, 'Error in order callback');
        }
      }
    }
  }

  private extractGridLevel(clientOrderId: string): number | undefined {
    if (clientOrderId?.startsWith('grid_')) {
      const parts = clientOrderId.split('_');
      if (parts.length >= 2) {
        const level = parseInt(parts[1], 10);
        if (!isNaN(level)) return level;
      }
    }
    return undefined;
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info({ attempt: this.reconnectAttempts, delay }, 'Attempting to reconnect');

    setTimeout(async () => {
      try {
        await this.connect();
        // Re-subscribe to all symbols
        for (const symbol of this.subscribedSymbols) {
          this.subscribeToTicker(symbol);
        }
        // Re-start user stream if it was active
        if (this.userStreamListenKey) {
          await this.startUserDataStream();
        }
      } catch (error) {
        logger.error({ error }, 'Reconnection failed');
      }
    }, delay);
  }

  private notifyConnectionStatus(connected: boolean): void {
    for (const callback of this.connectionCallbacks) {
      try {
        callback(connected);
      } catch (error) {
        logger.error({ error }, 'Error in connection callback');
      }
    }
  }

  /**
   * Subscribe to real-time ticker updates for a symbol
   */
  subscribeToTicker(symbol: string): void {
    if (!this.wsClient) {
      logger.warn('WebSocket not connected, cannot subscribe to ticker');
      return;
    }

    if (this.subscribedSymbols.has(symbol)) {
      logger.debug({ symbol }, 'Already subscribed to ticker');
      return;
    }

    this.wsClient.subscribeSpotSymbol24hrTicker(symbol);
    this.subscribedSymbols.add(symbol);
    logger.info({ symbol }, 'Subscribed to ticker stream');
  }

  /**
   * Subscribe to real-time trade updates for a symbol
   */
  subscribeToTrades(symbol: string): void {
    if (!this.wsClient) {
      logger.warn('WebSocket not connected, cannot subscribe to trades');
      return;
    }

    this.wsClient.subscribeSpotTrades(symbol);
    logger.info({ symbol }, 'Subscribed to trade stream');
  }

  /**
   * Unsubscribe from ticker updates for a symbol
   */
  unsubscribeFromTicker(symbol: string): void {
    if (!this.wsClient) return;

    // Note: The binance library may not have a direct unsubscribe method
    // In production, you might need to close and reopen with new subscriptions
    this.subscribedSymbols.delete(symbol);
    this.tickerCallbacks.delete(symbol);
    logger.info({ symbol }, 'Unsubscribed from ticker stream');
  }

  /**
   * Start user data stream for order updates
   */
  async startUserDataStream(): Promise<void> {
    if (!this.wsClient || !this.restClient) {
      logger.warn('WebSocket or REST client not connected');
      return;
    }

    try {
      // Get a listen key for user data stream
      const response = await this.restClient.getSpotUserDataListenKey();
      this.userStreamListenKey = response.listenKey;

      // Subscribe to user data stream
      this.wsClient.subscribeSpotUserDataStream();

      // Keep the listen key alive (must be done every 30 minutes)
      this.startListenKeyKeepAlive();

      logger.info('User data stream started');
    } catch (error) {
      logger.error({ error }, 'Failed to start user data stream');
      throw error;
    }
  }

  private startListenKeyKeepAlive(): void {
    // Clear any existing interval
    if (this.userStreamKeepAliveInterval) {
      clearInterval(this.userStreamKeepAliveInterval);
    }

    // Keep alive every 25 minutes (before the 30 min expiry)
    this.userStreamKeepAliveInterval = setInterval(async () => {
      if (!this.restClient || !this.userStreamListenKey) return;

      try {
        await this.restClient.keepAliveSpotUserDataListenKey(this.userStreamListenKey);
        logger.debug('User data stream listen key kept alive');
      } catch (error) {
        logger.error({ error }, 'Failed to keep alive listen key');
        // Try to get a new listen key
        try {
          const response = await this.restClient.getSpotUserDataListenKey();
          this.userStreamListenKey = response.listenKey;
        } catch (e) {
          logger.error({ error: e }, 'Failed to get new listen key');
        }
      }
    }, 25 * 60 * 1000); // 25 minutes
  }

  /**
   * Register a callback for ticker updates
   */
  onTicker(symbol: string, callback: TickerCallback): void {
    const callbacks = this.tickerCallbacks.get(symbol) || [];
    callbacks.push(callback);
    this.tickerCallbacks.set(symbol, callbacks);
  }

  /**
   * Register a callback for trade updates
   */
  onTrade(symbol: string, callback: TradeCallback): void {
    const callbacks = this.tradeCallbacks.get(symbol) || [];
    callbacks.push(callback);
    this.tradeCallbacks.set(symbol, callbacks);
  }

  /**
   * Register a callback for order updates
   */
  onOrder(callback: OrderCallback): void {
    this.orderCallbacks.push(callback);
  }

  /**
   * Register a callback for connection status changes
   */
  onConnectionChange(callback: ConnectionCallback): void {
    this.connectionCallbacks.push(callback);
  }

  /**
   * Remove all callbacks for a symbol
   */
  removeCallbacks(symbol: string): void {
    this.tickerCallbacks.delete(symbol);
    this.tradeCallbacks.delete(symbol);
  }

  /**
   * Disconnect from all WebSocket streams
   */
  async disconnect(): Promise<void> {
    if (this.userStreamKeepAliveInterval) {
      clearInterval(this.userStreamKeepAliveInterval);
      this.userStreamKeepAliveInterval = null;
    }

    if (this.wsClient) {
      this.wsClient.closeAll();
      this.wsClient = null;
    }

    this.subscribedSymbols.clear();
    this.tickerCallbacks.clear();
    this.tradeCallbacks.clear();
    this.orderCallbacks = [];
    this.isConnected = false;
    this.userStreamListenKey = null;

    logger.info('Disconnected from Binance streams');
  }

  /**
   * Get connection status
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get list of subscribed symbols
   */
  get symbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }
}

// Singleton instance
export const binanceStreams = new BinanceStreamManager();
