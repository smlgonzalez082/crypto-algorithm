import { createLogger } from '../utils/logger.js';
import { config, getGridLevels } from '../utils/config.js';
import { BinanceClient } from '../exchange/binance.js';
import { RiskManager } from './risk.js';
import type { GridConfig, Order, BotStatus, GridLevel } from '../types/index.js';

const logger = createLogger('grid');

export class GridBot {
  private client: BinanceClient;
  private riskManager: RiskManager;
  private gridConfig: GridConfig;
  private gridLevels: GridLevel[] = [];
  private activeOrders: Map<string, Order> = new Map();
  private status: BotStatus = 'stopped';
  private currentPrice = 0;
  private totalPnl = 0;
  private tradesCount = 0;
  private startTime: Date | null = null;

  constructor(client: BinanceClient, riskManager: RiskManager) {
    this.client = client;
    this.riskManager = riskManager;
    this.gridConfig = {
      tradingPair: config.tradingPair,
      upperPrice: config.gridUpper,
      lowerPrice: config.gridLower,
      gridCount: config.gridCount,
      amountPerGrid: config.amountPerGrid,
      gridType: config.gridType,
    };
  }

  async start(): Promise<void> {
    if (this.status === 'running') {
      logger.warn('Bot is already running');
      return;
    }

    try {
      logger.info('Starting grid bot...');
      this.status = 'starting';

      // Connect to exchange
      await this.client.connect();

      // Initialize balance for risk manager
      const balance = await this.client.getBalance(config.quoteAsset);
      this.riskManager.updateBalance(balance.total);

      // Get current price
      this.currentPrice = await this.client.getCurrentPrice();
      logger.info({ currentPrice: this.currentPrice }, 'Current price fetched');

      // Initialize grid levels
      this.initializeGridLevels();

      // Place initial orders
      await this.placeInitialOrders();

      // Start price stream
      await this.client.startPriceStream();
      this.client.onPriceUpdate((price) => this.handlePriceUpdate(price));

      // Start user stream for order updates
      await this.client.startUserStream();
      this.client.onOrderUpdate((order) => this.handleOrderUpdate(order));

      this.status = 'running';
      this.startTime = new Date();
      logger.info('Grid bot started successfully');
    } catch (error) {
      this.status = 'error';
      logger.error({ error }, 'Failed to start grid bot');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      logger.warn('Bot is already stopped');
      return;
    }

    try {
      logger.info('Stopping grid bot...');
      this.status = 'stopping';

      // Cancel all open orders
      await this.client.cancelAllOrders();
      this.activeOrders.clear();

      // Disconnect from exchange
      await this.client.disconnect();

      this.status = 'stopped';
      logger.info('Grid bot stopped');
    } catch (error) {
      this.status = 'error';
      logger.error({ error }, 'Error stopping grid bot');
      throw error;
    }
  }

  private initializeGridLevels(): void {
    const prices = getGridLevels();
    this.gridLevels = prices.map((price, index) => ({
      level: index,
      price,
      buyOrderId: null,
      sellOrderId: null,
      status: 'empty' as const,
    }));

    logger.info(
      { levelCount: this.gridLevels.length, prices },
      'Grid levels initialized'
    );
  }

  private async placeInitialOrders(): Promise<void> {
    const belowPrice: GridLevel[] = [];
    const abovePrice: GridLevel[] = [];

    // Separate levels into buy (below current price) and sell (above current price)
    for (const level of this.gridLevels) {
      if (level.price < this.currentPrice) {
        belowPrice.push(level);
      } else if (level.price > this.currentPrice) {
        abovePrice.push(level);
      }
    }

    logger.info(
      {
        buyLevels: belowPrice.length,
        sellLevels: abovePrice.length,
        currentPrice: this.currentPrice,
      },
      'Placing initial orders'
    );

    // Place buy orders below current price
    for (const level of belowPrice) {
      await this.placeBuyOrder(level);
    }

    // Place sell orders above current price
    for (const level of abovePrice) {
      await this.placeSellOrder(level);
    }
  }

  private async placeBuyOrder(level: GridLevel): Promise<void> {
    const check = this.riskManager.canPlaceOrder(
      'BUY',
      this.gridConfig.amountPerGrid,
      level.price,
      this.activeOrders.size
    );

    if (!check.allowed) {
      logger.warn({ level: level.level, reason: check.reason }, 'Buy order blocked by risk manager');
      return;
    }

    try {
      const order = await this.client.placeLimitOrder(
        'BUY',
        level.price,
        this.gridConfig.amountPerGrid,
        level.level
      );

      level.buyOrderId = order.orderId;
      level.status = 'buy_pending';
      this.activeOrders.set(order.orderId, order);

      logger.debug(
        { level: level.level, price: level.price, orderId: order.orderId },
        'Buy order placed'
      );
    } catch (error) {
      logger.error({ error, level: level.level }, 'Failed to place buy order');
    }
  }

  private async placeSellOrder(level: GridLevel): Promise<void> {
    const check = this.riskManager.canPlaceOrder(
      'SELL',
      this.gridConfig.amountPerGrid,
      level.price,
      this.activeOrders.size
    );

    if (!check.allowed) {
      logger.warn({ level: level.level, reason: check.reason }, 'Sell order blocked by risk manager');
      return;
    }

    try {
      const order = await this.client.placeLimitOrder(
        'SELL',
        level.price,
        this.gridConfig.amountPerGrid,
        level.level
      );

      level.sellOrderId = order.orderId;
      level.status = 'sell_pending';
      this.activeOrders.set(order.orderId, order);

      logger.debug(
        { level: level.level, price: level.price, orderId: order.orderId },
        'Sell order placed'
      );
    } catch (error) {
      logger.error({ error, level: level.level }, 'Failed to place sell order');
    }
  }

  private handlePriceUpdate(price: number): void {
    this.currentPrice = price;

    // Check stop loss and take profit
    if (this.riskManager.checkStopLoss(price, this.gridConfig)) {
      logger.warn('Stop loss triggered, stopping bot');
      this.stop();
      return;
    }

    if (this.riskManager.checkTakeProfit(price, this.gridConfig)) {
      logger.info('Take profit triggered, stopping bot');
      this.stop();
      return;
    }

    // Reset daily metrics if needed
    if (this.riskManager.shouldResetDaily()) {
      this.riskManager.resetDailyMetrics();
    }
  }

  private async handleOrderUpdate(order: Order): Promise<void> {
    const existingOrder = this.activeOrders.get(order.orderId);
    if (!existingOrder) return;

    // Update stored order
    this.activeOrders.set(order.orderId, order);

    // Handle filled orders
    if (order.status === 'FILLED') {
      await this.handleFilledOrder(order);
    } else if (order.status === 'CANCELED' || order.status === 'EXPIRED') {
      this.activeOrders.delete(order.orderId);
    }
  }

  private async handleFilledOrder(order: Order): Promise<void> {
    const level = this.gridLevels.find(
      (l) => l.buyOrderId === order.orderId || l.sellOrderId === order.orderId
    );

    if (!level) {
      logger.warn({ orderId: order.orderId }, 'Filled order not found in grid levels');
      return;
    }

    this.activeOrders.delete(order.orderId);
    this.tradesCount++;

    if (order.side === 'BUY') {
      // Buy order filled - place sell order at next level up
      logger.info(
        { level: level.level, price: order.price, quantity: order.quantity },
        'Buy order filled'
      );

      level.buyOrderId = null;
      level.status = 'bought';

      // Find next level up for sell order
      const nextLevel = this.gridLevels.find((l) => l.level === level.level + 1);
      if (nextLevel && !nextLevel.sellOrderId) {
        await this.placeSellOrder(nextLevel);
      }

      // Calculate PnL for grid completion
      const pnl = -order.price * order.quantity; // Cost of buy
      this.riskManager.recordTradePnl(pnl);
    } else {
      // Sell order filled - place buy order at next level down
      logger.info(
        { level: level.level, price: order.price, quantity: order.quantity },
        'Sell order filled'
      );

      level.sellOrderId = null;
      level.status = 'sold';

      // Find next level down for buy order
      const prevLevel = this.gridLevels.find((l) => l.level === level.level - 1);
      if (prevLevel && !prevLevel.buyOrderId) {
        await this.placeBuyOrder(prevLevel);
      }

      // Calculate PnL for grid completion (profit from sell)
      const pnl = order.price * order.quantity;
      this.riskManager.recordTradePnl(pnl);
      this.totalPnl += pnl;
    }

    // Update balance
    const balance = await this.client.getBalance(config.quoteAsset);
    this.riskManager.updateBalance(balance.total);
  }

  getStatus(): {
    status: BotStatus;
    currentPrice: number;
    gridConfig: GridConfig;
    activeOrdersCount: number;
    totalPnl: number;
    tradesCount: number;
    uptime: number;
    riskReport: Record<string, unknown>;
  } {
    return {
      status: this.status,
      currentPrice: this.currentPrice,
      gridConfig: this.gridConfig,
      activeOrdersCount: this.activeOrders.size,
      totalPnl: this.totalPnl,
      tradesCount: this.tradesCount,
      uptime: this.startTime
        ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
        : 0,
      riskReport: this.riskManager.getRiskReport(),
    };
  }

  getGridLevels(): GridLevel[] {
    return [...this.gridLevels];
  }

  getActiveOrders(): Order[] {
    return Array.from(this.activeOrders.values());
  }

  async updateConfig(newConfig: Partial<GridConfig>): Promise<void> {
    if (this.status === 'running') {
      throw new Error('Cannot update config while bot is running');
    }

    this.gridConfig = { ...this.gridConfig, ...newConfig };
    logger.info({ newConfig }, 'Grid config updated');
  }
}
