import Binance from 'binance';
import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import type { Order, OrderSide, OrderStatus, Trade, Balance } from '../types/index.js';

const logger = createLogger('binance');

type PriceCallback = (price: number) => void;
type OrderCallback = (order: Order) => void;

// Simulated order for tracking in simulation mode
interface SimulatedOrder extends Order {
  isSimulated: true;
}

export class BinanceClient {
  private client: Binance.MainClient | null = null;
  private wsClient: Binance.WebsocketClient | null = null;
  private symbolInfo: {
    tickSize?: number;
    stepSize?: number;
    minNotional?: number;
  } = {};
  private priceCallbacks: PriceCallback[] = [];
  private orderCallbacks: OrderCallback[] = [];
  private isConnected = false;

  // Simulation state
  private simulatedOrders: Map<string, SimulatedOrder> = new Map();
  private simulatedOrderIdCounter = 1000000;
  private simulatedBalances: Map<string, Balance> = new Map();
  private _lastPrice = 0;

  /** Get the last known price */
  get lastPrice(): number {
    return this._lastPrice;
  }

  async connect(): Promise<void> {
    try {
      let baseUrl: string | undefined;
      if (config.binanceTestnet) {
        baseUrl = 'https://testnet.binance.vision';
      } else if (config.binanceUs) {
        baseUrl = 'https://api.binance.us';
      }

      this.client = new Binance.MainClient({
        api_key: config.binanceApiKey,
        api_secret: config.binanceApiSecret,
        baseUrl,
      });

      // Load symbol info
      await this.loadSymbolInfo();

      // Initialize simulated balances if in simulation mode
      if (config.simulationMode) {
        this.initializeSimulatedBalances();
        logger.info('Running in SIMULATION MODE - no real orders will be placed');
      }

      this.isConnected = true;
      logger.info({ testnet: config.binanceTestnet, binanceUs: config.binanceUs, simulationMode: config.simulationMode }, 'Connected to Binance');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to Binance');
      throw error;
    }
  }

  private initializeSimulatedBalances(): void {
    // Initialize with configured capital
    const quoteAsset = config.quoteAsset || 'USDT';
    const baseAsset = config.baseAsset || 'DOGE';

    this.simulatedBalances.set(quoteAsset, {
      asset: quoteAsset,
      free: config.totalCapital,
      locked: 0,
      total: config.totalCapital,
    });

    this.simulatedBalances.set(baseAsset, {
      asset: baseAsset,
      free: 0,
      locked: 0,
      total: 0,
    });

    logger.info({ quoteAsset, capital: config.totalCapital }, 'Simulated balances initialized');
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.closeAll();
      this.wsClient = null;
    }
    this.isConnected = false;
    logger.info('Disconnected from Binance');
  }

  private async loadSymbolInfo(): Promise<void> {
    if (!this.client) return;

    try {
      const exchangeInfo = await this.client.getExchangeInfo();
      const symbolData = exchangeInfo.symbols.find(
        (s) => s.symbol === config.tradingPair
      );

      if (symbolData) {
        for (const filter of symbolData.filters) {
          if (filter.filterType === 'PRICE_FILTER') {
            this.symbolInfo.tickSize = parseFloat(String((filter as { tickSize: string }).tickSize));
          } else if (filter.filterType === 'LOT_SIZE') {
            this.symbolInfo.stepSize = parseFloat(String((filter as { stepSize: string }).stepSize));
          } else if (filter.filterType === 'NOTIONAL') {
            this.symbolInfo.minNotional = parseFloat(String((filter as { minNotional: string }).minNotional));
          }
        }
        logger.debug({ symbolInfo: this.symbolInfo }, 'Symbol info loaded');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load symbol info');
    }
  }

  roundPrice(price: number): number {
    if (!this.symbolInfo.tickSize) return price;
    return Math.floor(price / this.symbolInfo.tickSize) * this.symbolInfo.tickSize;
  }

  roundQuantity(quantity: number): number {
    if (!this.symbolInfo.stepSize) return quantity;
    return Math.floor(quantity / this.symbolInfo.stepSize) * this.symbolInfo.stepSize;
  }

  async getCurrentPrice(): Promise<number> {
    if (!this.client) throw new Error('Client not connected');

    const ticker = await this.client.getSymbolPriceTicker({
      symbol: config.tradingPair,
    });

    if (Array.isArray(ticker)) {
      throw new Error('Unexpected response from Binance');
    }

    return parseFloat(String(ticker.price));
  }

  async getBalances(): Promise<Balance[]> {
    if (!this.client) throw new Error('Client not connected');

    // Return simulated balances in simulation mode
    if (config.simulationMode) {
      return Array.from(this.simulatedBalances.values()).filter(b => b.total > 0);
    }

    const account = await this.client.getAccountInformation();
    return account.balances
      .filter((b) => parseFloat(String(b.free)) > 0 || parseFloat(String(b.locked)) > 0)
      .map((b) => ({
        asset: b.asset,
        free: parseFloat(String(b.free)),
        locked: parseFloat(String(b.locked)),
        total: parseFloat(String(b.free)) + parseFloat(String(b.locked)),
      }));
  }

  async getBalance(asset: string): Promise<Balance> {
    const balances = await this.getBalances();
    const balance = balances.find((b) => b.asset === asset);
    return balance || { asset, free: 0, locked: 0, total: 0 };
  }

  async placeLimitOrder(
    side: OrderSide,
    price: number,
    quantity: number,
    gridLevel?: number
  ): Promise<Order> {
    if (!this.client) throw new Error('Client not connected');

    const roundedPrice = this.roundPrice(price);
    const roundedQuantity = this.roundQuantity(quantity);

    // Validate minimum notional
    const notional = roundedPrice * roundedQuantity;
    if (this.symbolInfo.minNotional && notional < this.symbolInfo.minNotional) {
      throw new Error(
        `Order notional ${notional} below minimum ${this.symbolInfo.minNotional}`
      );
    }

    const clientOrderId = `grid_${gridLevel ?? 0}_${side}_${Date.now()}`;

    // SIMULATION MODE: Create simulated order instead of real one
    if (config.simulationMode) {
      return this.placeSimulatedOrder(side, roundedPrice, roundedQuantity, gridLevel, clientOrderId);
    }

    try {
      const result = await this.client.submitNewOrder({
        symbol: config.tradingPair,
        side: side as 'BUY' | 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price: roundedPrice,
        quantity: roundedQuantity,
        newClientOrderId: clientOrderId,
      });

      // Type assertion for the result
      const orderResult = result as {
        orderId: number;
        clientOrderId: string;
        symbol: string;
        side: string;
        type: string;
        price: string;
        origQty: string;
        executedQty: string;
        status: string;
        transactTime: number;
      };

      const order: Order = {
        orderId: orderResult.orderId.toString(),
        clientOrderId: orderResult.clientOrderId,
        tradingPair: orderResult.symbol,
        side: orderResult.side as OrderSide,
        orderType: orderResult.type,
        price: parseFloat(String(orderResult.price)),
        quantity: parseFloat(String(orderResult.origQty)),
        filledQuantity: parseFloat(String(orderResult.executedQty)),
        status: orderResult.status as OrderStatus,
        gridLevel,
        createdAt: new Date(orderResult.transactTime),
      };

      logger.info(
        { orderId: order.orderId, side, price: roundedPrice, quantity: roundedQuantity },
        'Order placed'
      );

      return order;
    } catch (error) {
      logger.error({ error, side, price, quantity }, 'Failed to place order');
      throw error;
    }
  }

  private placeSimulatedOrder(
    side: OrderSide,
    price: number,
    quantity: number,
    gridLevel?: number,
    clientOrderId?: string
  ): Order {
    const orderId = `SIM_${this.simulatedOrderIdCounter++}`;

    // Lock funds for the order
    const quoteAsset = config.quoteAsset || 'USDT';
    const baseAsset = config.baseAsset || 'DOGE';
    const quoteBalance = this.simulatedBalances.get(quoteAsset);
    const baseBalance = this.simulatedBalances.get(baseAsset);

    if (side === 'BUY') {
      const cost = price * quantity;
      if (quoteBalance && quoteBalance.free >= cost) {
        quoteBalance.free -= cost;
        quoteBalance.locked += cost;
      } else {
        logger.warn({ side, price, quantity, available: quoteBalance?.free }, 'Insufficient simulated balance for BUY');
      }
    } else {
      if (baseBalance && baseBalance.free >= quantity) {
        baseBalance.free -= quantity;
        baseBalance.locked += quantity;
      }
    }

    const order: SimulatedOrder = {
      orderId,
      clientOrderId: clientOrderId || `sim_${Date.now()}`,
      tradingPair: config.tradingPair,
      side,
      orderType: 'LIMIT',
      price,
      quantity,
      filledQuantity: 0,
      status: 'NEW',
      gridLevel,
      createdAt: new Date(),
      isSimulated: true,
    };

    this.simulatedOrders.set(orderId, order);

    logger.info(
      { orderId, side, price, quantity, gridLevel, simulated: true },
      '[SIMULATION] Order placed'
    );

    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.client) throw new Error('Client not connected');

    // SIMULATION MODE: Cancel simulated order
    if (config.simulationMode) {
      return this.cancelSimulatedOrder(orderId);
    }

    try {
      await this.client.cancelOrder({
        symbol: config.tradingPair,
        orderId: parseInt(orderId, 10),
      });
      logger.info({ orderId }, 'Order cancelled');
      return true;
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to cancel order');
      return false;
    }
  }

  private cancelSimulatedOrder(orderId: string): boolean {
    const order = this.simulatedOrders.get(orderId);
    if (!order) return false;

    // Unlock funds
    const quoteAsset = config.quoteAsset || 'USDT';
    const baseAsset = config.baseAsset || 'DOGE';
    const quoteBalance = this.simulatedBalances.get(quoteAsset);
    const baseBalance = this.simulatedBalances.get(baseAsset);

    if (order.side === 'BUY' && quoteBalance) {
      const cost = order.price * order.quantity;
      quoteBalance.locked -= cost;
      quoteBalance.free += cost;
    } else if (order.side === 'SELL' && baseBalance) {
      baseBalance.locked -= order.quantity;
      baseBalance.free += order.quantity;
    }

    this.simulatedOrders.delete(orderId);
    logger.info({ orderId, simulated: true }, '[SIMULATION] Order cancelled');
    return true;
  }

  async cancelAllOrders(): Promise<number> {
    if (!this.client) throw new Error('Client not connected');

    // SIMULATION MODE: Cancel all simulated orders
    if (config.simulationMode) {
      const count = this.simulatedOrders.size;
      for (const orderId of this.simulatedOrders.keys()) {
        this.cancelSimulatedOrder(orderId);
      }
      logger.info({ count, simulated: true }, '[SIMULATION] All orders cancelled');
      return count;
    }

    try {
      const result = await this.client.cancelAllSymbolOrders({
        symbol: config.tradingPair,
      });
      const count = Array.isArray(result) ? result.length : 0;
      logger.info({ count }, 'All orders cancelled');
      return count;
    } catch (error) {
      logger.error({ error }, 'Failed to cancel all orders');
      return 0;
    }
  }

  async getOpenOrders(): Promise<Order[]> {
    if (!this.client) throw new Error('Client not connected');

    // SIMULATION MODE: Return simulated open orders
    if (config.simulationMode) {
      return Array.from(this.simulatedOrders.values()).filter(
        o => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED'
      );
    }

    const orders = await this.client.getOpenOrders({
      symbol: config.tradingPair,
    });

    return orders.map((o) => ({
      orderId: o.orderId.toString(),
      clientOrderId: o.clientOrderId,
      tradingPair: o.symbol,
      side: o.side as OrderSide,
      orderType: o.type,
      price: parseFloat(String(o.price)),
      quantity: parseFloat(String(o.origQty)),
      filledQuantity: parseFloat(String(o.executedQty)),
      status: o.status as OrderStatus,
      gridLevel: this.extractGridLevel(o.clientOrderId),
      createdAt: new Date(o.time),
    }));
  }

  async getRecentTrades(limit = 50): Promise<Trade[]> {
    if (!this.client) throw new Error('Client not connected');

    const trades = await this.client.getAccountTradeList({
      symbol: config.tradingPair,
      limit,
    });

    return trades.map((t) => ({
      tradeId: t.id.toString(),
      orderId: t.orderId.toString(),
      tradingPair: t.symbol,
      side: t.isBuyer ? ('BUY' as OrderSide) : ('SELL' as OrderSide),
      price: parseFloat(String(t.price)),
      quantity: parseFloat(String(t.qty)),
      commission: parseFloat(String(t.commission)),
      commissionAsset: t.commissionAsset,
      realizedPnl: 0,
      createdAt: new Date(t.time),
    }));
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

  onPriceUpdate(callback: PriceCallback): void {
    this.priceCallbacks.push(callback);
  }

  onOrderUpdate(callback: OrderCallback): void {
    this.orderCallbacks.push(callback);
  }

  async startPriceStream(): Promise<void> {
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

    this.wsClient.on('formattedMessage', (data: unknown) => {
      const msg = data as { eventType?: string; close?: string };
      if (msg.eventType === '24hrTicker' && msg.close) {
        const price = parseFloat(msg.close);
        this._lastPrice = price;

        // In simulation mode, check if any orders should be filled
        if (config.simulationMode) {
          this.checkSimulatedOrderFills(price);
        }

        for (const callback of this.priceCallbacks) {
          callback(price);
        }
      }
    });

    this.wsClient.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
    });

    this.wsClient.subscribeSpotSymbol24hrTicker(config.tradingPair);
    logger.info('Price stream started');
  }

  async startUserStream(): Promise<void> {
    if (!this.wsClient) return;

    this.wsClient.on('formattedUserDataMessage', (data: unknown) => {
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
          filledQuantity: parseFloat(msg.lastFilledQuantity || '0'),
          status: (msg.orderStatus as OrderStatus) || 'NEW',
          gridLevel: this.extractGridLevel(msg.newClientOrderId || ''),
          createdAt: new Date(msg.eventTime || Date.now()),
        };

        for (const callback of this.orderCallbacks) {
          callback(order);
        }
      }
    });

    this.wsClient.subscribeSpotUserDataStream();
    logger.info('User stream started');
  }

  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Check if any simulated orders should be filled based on current price
   * BUY orders fill when price <= order price
   * SELL orders fill when price >= order price
   */
  private checkSimulatedOrderFills(currentPrice: number): void {
    const quoteAsset = config.quoteAsset || 'USDT';
    const baseAsset = config.baseAsset || 'DOGE';
    const quoteBalance = this.simulatedBalances.get(quoteAsset);
    const baseBalance = this.simulatedBalances.get(baseAsset);

    for (const [orderId, order] of this.simulatedOrders) {
      if (order.status !== 'NEW') continue;

      let shouldFill = false;

      if (order.side === 'BUY' && currentPrice <= order.price) {
        shouldFill = true;
      } else if (order.side === 'SELL' && currentPrice >= order.price) {
        shouldFill = true;
      }

      if (shouldFill) {
        // Update order status
        order.status = 'FILLED';
        order.filledQuantity = order.quantity;

        // Update balances
        if (order.side === 'BUY') {
          // Bought: locked quote -> free base
          const cost = order.price * order.quantity;
          if (quoteBalance) {
            quoteBalance.locked -= cost;
            quoteBalance.total = quoteBalance.free + quoteBalance.locked;
          }
          if (baseBalance) {
            baseBalance.free += order.quantity;
            baseBalance.total = baseBalance.free + baseBalance.locked;
          }
        } else {
          // Sold: locked base -> free quote
          const revenue = order.price * order.quantity;
          if (baseBalance) {
            baseBalance.locked -= order.quantity;
            baseBalance.total = baseBalance.free + baseBalance.locked;
          }
          if (quoteBalance) {
            quoteBalance.free += revenue;
            quoteBalance.total = quoteBalance.free + quoteBalance.locked;
          }
        }

        logger.info(
          {
            orderId,
            side: order.side,
            price: order.price,
            quantity: order.quantity,
            currentPrice,
            gridLevel: order.gridLevel,
            simulated: true,
          },
          '[SIMULATION] Order FILLED'
        );

        // Notify callbacks about the filled order
        for (const callback of this.orderCallbacks) {
          callback(order);
        }
      }
    }
  }

  /**
   * Get simulated trades (filled orders)
   */
  getSimulatedTrades(): Order[] {
    return Array.from(this.simulatedOrders.values()).filter(o => o.status === 'FILLED');
  }

  /**
   * Get current simulated balances
   */
  getSimulatedBalances(): Balance[] {
    return Array.from(this.simulatedBalances.values());
  }
}

export const binanceClient = new BinanceClient();
