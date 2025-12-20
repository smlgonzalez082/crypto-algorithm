import { createLogger } from '../utils/logger.js';
import { BinanceClient } from '../exchange/binance.js';
import { binanceStreams, TickerData } from '../exchange/binanceStreams.js';
import { PortfolioRiskManager } from './portfolioRisk.js';
import { correlationAnalyzer } from '../analysis/correlation.js';
import { tradingDb } from '../models/database.js';
import type {
  PairConfig,
  PortfolioState,
  PairState,
  PortfolioStatus,
  GridLevelState,
  RiskStrategy,
  RebalanceAction,
  PortfolioRiskMetrics,
} from '../types/portfolio.js';
import type { Order, OrderSide } from '../types/index.js';

const logger = createLogger('portfolio-bot');

interface PairGridBot {
  config: PairConfig;
  gridLevels: GridLevelState[];
  activeOrders: Map<string, Order>;
  currentPrice: number;
  positionSize: number; // Base asset quantity held
  positionValue: number; // Quote asset value
  realizedPnl: number;
  unrealizedPnl: number;
  tradesCount: number;
  status: 'stopped' | 'running' | 'paused' | 'error';
}

interface PortfolioConfig {
  pairs: PairConfig[];
  totalCapital: number;
  riskStrategy: RiskStrategy;
  rebalanceThreshold: number; // % deviation before rebalancing
  rebalanceInterval: number; // ms between rebalance checks
  priceHistoryDays: number; // Days of history for correlation
}

/**
 * Multi-Pair Portfolio Grid Bot
 *
 * Manages multiple grid trading bots simultaneously with:
 * - Correlation-aware allocation
 * - Portfolio-level risk management
 * - Automatic rebalancing
 * - Circuit breakers across all pairs
 */
export class PortfolioGridBot {
  private client: BinanceClient;
  private riskManager: PortfolioRiskManager;
  private config: PortfolioConfig;
  private pairBots: Map<string, PairGridBot> = new Map();
  private status: PortfolioStatus = 'stopped';
  private availableCapital: number;
  private allocatedCapital: number = 0;
  private startTime: Date | null = null;
  private rebalanceTimer: NodeJS.Timeout | null = null;
  private pricePollingInterval: NodeJS.Timeout | null = null;
  private useWebSocket: boolean = true; // Use WebSocket streams by default
  private wsConnected: boolean = false;

  constructor(client: BinanceClient, portfolioConfig: PortfolioConfig) {
    this.client = client;
    this.config = portfolioConfig;
    this.availableCapital = portfolioConfig.totalCapital;
    this.riskManager = new PortfolioRiskManager(portfolioConfig.riskStrategy);

    logger.info(
      {
        pairs: portfolioConfig.pairs.map((p) => p.symbol),
        totalCapital: portfolioConfig.totalCapital,
        strategy: portfolioConfig.riskStrategy,
      },
      'Portfolio bot initialized'
    );
  }

  // ===========================================================================
  // LIFECYCLE METHODS
  // ===========================================================================

  async start(): Promise<void> {
    if (this.status === 'running') {
      logger.warn('Portfolio bot is already running');
      return;
    }

    try {
      logger.info('Starting portfolio bot...');
      this.status = 'starting';

      // Connect to exchange
      await this.client.connect();

      // Fetch initial balances
      const balances = await this.client.getBalances();
      const usdtBalance = balances.find((b) => b.asset === 'USDT');
      if (usdtBalance) {
        this.availableCapital = Math.min(this.config.totalCapital, usdtBalance.free);
        this.riskManager.updatePortfolioValue(this.availableCapital);
      }

      // Load price history for correlation analysis
      await this.loadPriceHistory();

      // Initialize pair bots
      for (const pairConfig of this.config.pairs) {
        await this.initializePairBot(pairConfig);
      }

      // Restore state from database if available
      await this.restoreStateFromDb();

      // Start all pair bots
      for (const [symbol, pairBot] of this.pairBots) {
        await this.startPairBot(symbol, pairBot);
      }

      // Start price streams (WebSocket or polling)
      // This also starts user data stream for order updates
      await this.startPriceStreams();

      // Start rebalance timer
      this.startRebalanceTimer();

      this.status = 'running';
      this.startTime = new Date();
      logger.info('Portfolio bot started successfully');
    } catch (error) {
      this.status = 'error';
      logger.error({ error }, 'Failed to start portfolio bot');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      logger.warn('Portfolio bot is already stopped');
      return;
    }

    try {
      logger.info('Stopping portfolio bot...');
      this.status = 'stopping';

      // Stop rebalance timer
      if (this.rebalanceTimer) {
        clearInterval(this.rebalanceTimer);
        this.rebalanceTimer = null;
      }

      // Stop price polling if active
      if (this.pricePollingInterval) {
        clearInterval(this.pricePollingInterval);
        this.pricePollingInterval = null;
      }

      // Disconnect WebSocket streams
      if (this.useWebSocket) {
        await binanceStreams.disconnect();
        this.wsConnected = false;
      }

      // Cancel all orders for all pairs
      for (const [symbol, pairBot] of this.pairBots) {
        await this.stopPairBot(symbol, pairBot);
      }

      // Disconnect REST client
      await this.client.disconnect();

      this.status = 'stopped';
      logger.info('Portfolio bot stopped');
    } catch (error) {
      this.status = 'error';
      logger.error({ error }, 'Error stopping portfolio bot');
      throw error;
    }
  }

  // ===========================================================================
  // PAIR BOT MANAGEMENT
  // ===========================================================================

  private async initializePairBot(config: PairConfig): Promise<void> {
    // Calculate allocation based on correlation and volatility
    const existingPairs = Array.from(this.pairBots.keys());
    const optimalSize = this.riskManager.calculateOptimalPositionSize(
      config.symbol,
      0, // Will be updated with actual price
      this.availableCapital,
      existingPairs
    );

    // Use configured allocation or optimal
    const allocation = Math.min(
      this.availableCapital * (config.allocationPercent / 100),
      optimalSize.size
    );

    // Generate grid levels
    const gridLevels = this.generateGridLevels(config);

    const pairBot: PairGridBot = {
      config: { ...config },
      gridLevels,
      activeOrders: new Map(),
      currentPrice: 0,
      positionSize: 0,
      positionValue: allocation,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradesCount: 0,
      status: 'stopped',
    };

    this.pairBots.set(config.symbol, pairBot);
    this.allocatedCapital += allocation;
    this.availableCapital -= allocation;

    logger.info(
      {
        symbol: config.symbol,
        allocation,
        gridLevels: gridLevels.length,
        reason: optimalSize.reason,
      },
      'Pair bot initialized'
    );
  }

  private generateGridLevels(config: PairConfig): GridLevelState[] {
    const levels: GridLevelState[] = [];
    const { gridUpper, gridLower, gridCount, gridType } = config;

    if (gridType === 'geometric') {
      const ratio = Math.pow(gridUpper / gridLower, 1 / gridCount);
      for (let i = 0; i <= gridCount; i++) {
        levels.push({
          level: i,
          price: gridLower * Math.pow(ratio, i),
          buyOrderId: null,
          sellOrderId: null,
          status: 'empty',
          filledAt: null,
        });
      }
    } else {
      const spacing = (gridUpper - gridLower) / gridCount;
      for (let i = 0; i <= gridCount; i++) {
        levels.push({
          level: i,
          price: gridLower + spacing * i,
          buyOrderId: null,
          sellOrderId: null,
          status: 'empty',
          filledAt: null,
        });
      }
    }

    return levels;
  }

  private async startPairBot(symbol: string, pairBot: PairGridBot): Promise<void> {
    try {
      // Get current price for this symbol
      pairBot.currentPrice = await this.fetchPriceForSymbol(symbol);

      logger.info({ symbol, price: pairBot.currentPrice }, 'Fetched current price');

      // Place initial grid orders
      await this.placeInitialOrders(symbol, pairBot);

      pairBot.status = 'running';
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to start pair bot');
      pairBot.status = 'error';
    }
  }

  private async stopPairBot(symbol: string, pairBot: PairGridBot): Promise<void> {
    try {
      // Cancel all active orders for this pair
      for (const [orderId] of pairBot.activeOrders) {
        await this.client.cancelOrder(orderId);
      }
      pairBot.activeOrders.clear();
      pairBot.status = 'stopped';
      logger.info({ symbol }, 'Pair bot stopped');
    } catch (error) {
      logger.error({ error, symbol }, 'Error stopping pair bot');
    }
  }

  // ===========================================================================
  // ORDER MANAGEMENT
  // ===========================================================================

  private async placeInitialOrders(symbol: string, pairBot: PairGridBot): Promise<void> {
    const currentPrice = pairBot.currentPrice;
    const belowPrice: GridLevelState[] = [];
    const abovePrice: GridLevelState[] = [];

    for (const level of pairBot.gridLevels) {
      if (level.price < currentPrice * 0.998) {
        // 0.2% buffer
        belowPrice.push(level);
      } else if (level.price > currentPrice * 1.002) {
        abovePrice.push(level);
      }
    }

    logger.info(
      {
        symbol,
        buyLevels: belowPrice.length,
        sellLevels: abovePrice.length,
        currentPrice,
      },
      'Placing initial orders'
    );

    // Place buy orders below current price
    for (const level of belowPrice) {
      await this.placeBuyOrder(symbol, pairBot, level);
    }

    // Note: For grid trading, we typically only place buy orders initially
    // Sell orders are placed after buys are filled
  }

  private async placeBuyOrder(
    symbol: string,
    pairBot: PairGridBot,
    level: GridLevelState
  ): Promise<void> {
    const totalOrders = this.getTotalOpenOrders();
    const pairOrders = pairBot.activeOrders.size;

    const check = this.riskManager.canPlaceOrder(
      symbol,
      'BUY',
      pairBot.config.amountPerGrid,
      level.price,
      pairOrders,
      totalOrders
    );

    if (!check.allowed) {
      logger.warn({ symbol, level: level.level, reason: check.reason }, 'Buy order blocked');
      return;
    }

    try {
      const order = await this.placeLimitOrderForSymbol(
        symbol,
        'BUY',
        level.price,
        pairBot.config.amountPerGrid,
        level.level
      );

      if (order) {
        level.buyOrderId = order.orderId;
        level.status = 'buy_pending';
        pairBot.activeOrders.set(order.orderId, order);

        logger.debug(
          { symbol, level: level.level, price: level.price, orderId: order.orderId },
          'Buy order placed'
        );
      }
    } catch (error) {
      logger.error({ error, symbol, level: level.level }, 'Failed to place buy order');
    }
  }

  private async placeSellOrder(
    symbol: string,
    pairBot: PairGridBot,
    level: GridLevelState
  ): Promise<void> {
    const totalOrders = this.getTotalOpenOrders();
    const pairOrders = pairBot.activeOrders.size;

    const check = this.riskManager.canPlaceOrder(
      symbol,
      'SELL',
      pairBot.config.amountPerGrid,
      level.price,
      pairOrders,
      totalOrders
    );

    if (!check.allowed) {
      logger.warn({ symbol, level: level.level, reason: check.reason }, 'Sell order blocked');
      return;
    }

    try {
      const order = await this.placeLimitOrderForSymbol(
        symbol,
        'SELL',
        level.price,
        pairBot.config.amountPerGrid,
        level.level
      );

      if (order) {
        level.sellOrderId = order.orderId;
        level.status = 'sell_pending';
        pairBot.activeOrders.set(order.orderId, order);

        logger.debug(
          { symbol, level: level.level, price: level.price, orderId: order.orderId },
          'Sell order placed'
        );
      }
    } catch (error) {
      logger.error({ error, symbol, level: level.level }, 'Failed to place sell order');
    }
  }

  private getTotalOpenOrders(): number {
    let total = 0;
    for (const [, pairBot] of this.pairBots) {
      total += pairBot.activeOrders.size;
    }
    return total;
  }

  // ===========================================================================
  // ORDER UPDATE HANDLING
  // ===========================================================================

  private async handleOrderUpdate(order: Order): Promise<void> {
    // Find which pair this order belongs to
    for (const [symbol, pairBot] of this.pairBots) {
      if (order.tradingPair === symbol) {
        const existingOrder = pairBot.activeOrders.get(order.orderId);
        if (!existingOrder) return;

        pairBot.activeOrders.set(order.orderId, order);

        if (order.status === 'FILLED') {
          await this.handleFilledOrder(symbol, pairBot, order);
        } else if (order.status === 'CANCELED' || order.status === 'EXPIRED') {
          pairBot.activeOrders.delete(order.orderId);
        }
        return;
      }
    }
  }

  private async handleFilledOrder(
    symbol: string,
    pairBot: PairGridBot,
    order: Order
  ): Promise<void> {
    const level = pairBot.gridLevels.find(
      (l) => l.buyOrderId === order.orderId || l.sellOrderId === order.orderId
    );

    if (!level) {
      logger.warn({ symbol, orderId: order.orderId }, 'Filled order not found in grid levels');
      return;
    }

    pairBot.activeOrders.delete(order.orderId);
    pairBot.tradesCount++;

    const orderValue = order.price * order.quantity;
    let realizedPnl = 0;

    if (order.side === 'BUY') {
      logger.info(
        { symbol, level: level.level, price: order.price, quantity: order.quantity },
        'Buy order filled'
      );

      level.buyOrderId = null;
      level.status = 'bought';
      level.filledAt = new Date();

      // Update position
      pairBot.positionSize += order.quantity;
      pairBot.positionValue -= orderValue;

      // Place sell order at next level up
      const nextLevel = pairBot.gridLevels.find((l) => l.level === level.level + 1);
      if (nextLevel && !nextLevel.sellOrderId) {
        await this.placeSellOrder(symbol, pairBot, nextLevel);
      }

      // Record trade
      this.riskManager.recordTrade(symbol, -orderValue);
    } else {
      logger.info(
        { symbol, level: level.level, price: order.price, quantity: order.quantity },
        'Sell order filled'
      );

      level.sellOrderId = null;
      level.status = 'sold';
      level.filledAt = new Date();

      // Update position
      pairBot.positionSize -= order.quantity;
      pairBot.positionValue += orderValue;

      // Calculate grid profit (simplified)
      const gridSpacing = pairBot.config.gridUpper - pairBot.config.gridLower;
      realizedPnl = (gridSpacing / pairBot.config.gridCount) * order.quantity;
      pairBot.realizedPnl += realizedPnl;

      // Place buy order at next level down
      const prevLevel = pairBot.gridLevels.find((l) => l.level === level.level - 1);
      if (prevLevel && !prevLevel.buyOrderId) {
        await this.placeBuyOrder(symbol, pairBot, prevLevel);
      }

      // Record trade
      this.riskManager.recordTrade(symbol, orderValue);
    }

    // Persist to database
    tradingDb.saveTrade({
      tradeId: `${order.orderId}_${Date.now()}`,
      orderId: order.orderId,
      symbol,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      realizedPnl,
      gridLevel: level.level,
      executedAt: new Date(),
    });

    // Save updated grid state
    tradingDb.saveGridState(symbol, pairBot.gridLevels);

    // Save pair state
    tradingDb.savePairState({
      symbol,
      status: pairBot.status,
      currentPrice: pairBot.currentPrice,
      positionSize: pairBot.positionSize,
      positionValue: pairBot.positionValue,
      realizedPnl: pairBot.realizedPnl,
      unrealizedPnl: pairBot.unrealizedPnl,
      tradesCount: pairBot.tradesCount,
    });

    // Update portfolio value
    this.updatePortfolioValue();
  }

  // ===========================================================================
  // PRICE MANAGEMENT
  // ===========================================================================

  private async startPriceStreams(): Promise<void> {
    if (this.useWebSocket) {
      await this.startWebSocketStreams();
    } else {
      await this.startPollingStreams();
    }
  }

  /**
   * Start real-time WebSocket streams for all pairs
   * This provides instant price updates (sub-second latency)
   */
  private async startWebSocketStreams(): Promise<void> {
    try {
      // Connect to Binance WebSocket
      await binanceStreams.connect();

      // Track connection status
      binanceStreams.onConnectionChange((connected) => {
        this.wsConnected = connected;
        if (!connected) {
          logger.warn('WebSocket disconnected, falling back to polling');
          this.startFallbackPolling();
        } else {
          logger.info('WebSocket connected, stopping fallback polling');
          this.stopFallbackPolling();
        }
      });

      // Subscribe to ticker streams for all pairs
      for (const [symbol] of this.pairBots) {
        binanceStreams.subscribeToTicker(symbol);

        // Register callback for this symbol
        binanceStreams.onTicker(symbol, (ticker: TickerData) => {
          this.handleTickerUpdate(ticker);
        });
      }

      // Start user data stream for order updates
      await binanceStreams.startUserDataStream();

      // Register order update callback
      binanceStreams.onOrder((order) => {
        this.handleOrderUpdate(order);
      });

      this.wsConnected = true;
      logger.info(
        { symbols: Array.from(this.pairBots.keys()) },
        'WebSocket streams started for all pairs'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to start WebSocket streams, falling back to polling');
      this.useWebSocket = false;
      await this.startPollingStreams();
    }
  }

  /**
   * Handle real-time ticker updates from WebSocket
   */
  private handleTickerUpdate(ticker: TickerData): void {
    const { symbol, price, priceChangePercent, volume } = ticker;

    // Update price
    this.handlePriceUpdate(symbol, price);

    // Log significant price changes
    if (Math.abs(priceChangePercent) > 5) {
      logger.info(
        { symbol, price, priceChangePercent, volume },
        'Significant price movement detected'
      );
    }
  }

  /**
   * Start polling-based price updates (fallback or primary if WebSocket unavailable)
   */
  private async startPollingStreams(): Promise<void> {
    logger.info('Starting polling-based price streams (5s interval)');

    // Initial price fetch
    for (const [symbol] of this.pairBots) {
      try {
        const price = await this.fetchPriceForSymbol(symbol);
        this.handlePriceUpdate(symbol, price);
      } catch (error) {
        logger.error({ error, symbol }, 'Failed to fetch initial price');
      }
    }

    // Start polling interval
    this.startPricePolling();
  }

  private startPricePolling(): void {
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
    }

    // Poll prices every 5 seconds for all pairs
    this.pricePollingInterval = setInterval(async () => {
      for (const [symbol] of this.pairBots) {
        try {
          const price = await this.fetchPriceForSymbol(symbol);
          this.handlePriceUpdate(symbol, price);
        } catch (error) {
          logger.error({ error, symbol }, 'Failed to fetch price');
        }
      }
    }, 5000);
  }

  /**
   * Start fallback polling when WebSocket disconnects
   */
  private startFallbackPolling(): void {
    if (!this.pricePollingInterval) {
      logger.info('Starting fallback polling due to WebSocket disconnect');
      this.startPricePolling();
    }
  }

  /**
   * Stop fallback polling when WebSocket reconnects
   */
  private stopFallbackPolling(): void {
    if (this.pricePollingInterval && this.wsConnected) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
      logger.info('Stopped fallback polling, WebSocket active');
    }
  }

  private handlePriceUpdate(symbol: string, price: number): void {
    const pairBot = this.pairBots.get(symbol);
    if (!pairBot) return;

    pairBot.currentPrice = price;

    // Update unrealized PnL
    if (pairBot.positionSize > 0) {
      const avgBuyPrice =
        pairBot.gridLevels
          .filter((l) => l.status === 'bought')
          .reduce((sum, l) => sum + l.price, 0) /
        Math.max(1, pairBot.gridLevels.filter((l) => l.status === 'bought').length);

      pairBot.unrealizedPnl = (price - avgBuyPrice) * pairBot.positionSize;
    }

    // Check if price is outside grid range
    if (price < pairBot.config.gridLower * 0.95 || price > pairBot.config.gridUpper * 1.05) {
      logger.warn(
        { symbol, price, gridLower: pairBot.config.gridLower, gridUpper: pairBot.config.gridUpper },
        'Price outside grid range'
      );
    }

    // Update correlation data
    correlationAnalyzer.updatePriceHistory(symbol, [{ timestamp: Date.now(), close: price }]);

    // Persist price to database (throttled - every minute)
    const now = Date.now();
    if (!this.lastPriceSave.get(symbol) || now - (this.lastPriceSave.get(symbol) || 0) > 60000) {
      tradingDb.savePricePoint(symbol, price);
      this.lastPriceSave.set(symbol, now);
    }
  }

  private lastPriceSave: Map<string, number> = new Map();

  // ===========================================================================
  // REBALANCING
  // ===========================================================================

  private startRebalanceTimer(): void {
    this.rebalanceTimer = setInterval(() => {
      this.checkAndRebalance();
    }, this.config.rebalanceInterval);
  }

  private async checkAndRebalance(): Promise<void> {
    if (this.status !== 'running') return;

    const state = this.getPortfolioState();
    const actions = this.riskManager.suggestRebalance(state);

    if (actions.length > 0) {
      logger.info({ actions: actions.length }, 'Rebalance suggested');

      for (const action of actions) {
        if (Math.abs(action.currentAllocation - action.targetAllocation) > this.config.rebalanceThreshold) {
          await this.executeRebalanceAction(action);
        }
      }
    }
  }

  private async executeRebalanceAction(action: RebalanceAction): Promise<void> {
    const pairBot = this.pairBots.get(action.pair);
    if (!pairBot) return;

    logger.info(
      {
        pair: action.pair,
        type: action.type,
        current: action.currentAllocation.toFixed(1),
        target: action.targetAllocation.toFixed(1),
        reason: action.reason,
      },
      'Executing rebalance'
    );

    // Simplified rebalance: adjust grid amount
    const adjustmentFactor = action.targetAllocation / Math.max(0.1, action.currentAllocation);
    pairBot.config.amountPerGrid *= adjustmentFactor;

    // Could also cancel and replace orders here for more aggressive rebalancing
  }

  // ===========================================================================
  // PRICE HISTORY FOR CORRELATION
  // ===========================================================================

  private async loadPriceHistory(): Promise<void> {
    logger.info('Loading price history for correlation analysis...');

    for (const pairConfig of this.config.pairs) {
      try {
        // Load from database first
        const dbHistory = tradingDb.getPriceHistory(pairConfig.symbol, 30);
        if (dbHistory.length > 0) {
          correlationAnalyzer.updatePriceHistory(
            pairConfig.symbol,
            dbHistory.map(p => ({ timestamp: p.timestamp, close: p.price }))
          );
          logger.info({ symbol: pairConfig.symbol, points: dbHistory.length }, 'Loaded price history from database');
        }
      } catch (error) {
        logger.warn({ error, symbol: pairConfig.symbol }, 'Failed to load price history');
      }
    }
  }

  // ===========================================================================
  // STATE RESTORATION
  // ===========================================================================

  /**
   * Restores state from database after restart
   */
  private async restoreStateFromDb(): Promise<void> {
    logger.info('Attempting to restore state from database...');

    // Get last portfolio snapshot
    const snapshot = tradingDb.getLatestPortfolioSnapshot();
    if (snapshot) {
      logger.info({ snapshot }, 'Found previous portfolio snapshot');
    }

    // Restore pair states
    for (const pairConfig of this.config.pairs) {
      const savedState = tradingDb.getPairState(pairConfig.symbol);
      const savedGrid = tradingDb.getGridState(pairConfig.symbol);

      if (savedState && savedGrid.length > 0) {
        const pairBot = this.pairBots.get(pairConfig.symbol);
        if (pairBot) {
          // Restore grid levels
          pairBot.gridLevels = savedGrid;
          pairBot.positionSize = savedState.positionSize;
          pairBot.positionValue = savedState.positionValue;
          pairBot.realizedPnl = savedState.realizedPnl;
          pairBot.unrealizedPnl = savedState.unrealizedPnl;
          pairBot.tradesCount = savedState.tradesCount;

          logger.info(
            {
              symbol: pairConfig.symbol,
              trades: savedState.tradesCount,
              pnl: savedState.realizedPnl,
            },
            'Restored pair state from database'
          );
        }
      }
    }
  }

  /**
   * Gets trade history from database
   */
  getTradeHistory(symbol?: string, limit = 100): ReturnType<typeof tradingDb.getTrades> {
    return tradingDb.getTrades(symbol, limit);
  }

  /**
   * Gets trade statistics
   */
  getTradeStats(symbol?: string): ReturnType<typeof tradingDb.getTradeStats> {
    return tradingDb.getTradeStats(symbol);
  }

  /**
   * Gets risk event history
   */
  getRiskEvents(limit = 50): ReturnType<typeof tradingDb.getRecentRiskEvents> {
    return tradingDb.getRecentRiskEvents(limit);
  }

  // ===========================================================================
  // HELPER METHODS FOR MULTI-SYMBOL OPERATIONS
  // ===========================================================================

  private async fetchPriceForSymbol(symbol: string): Promise<number> {
    // This is a workaround since the current client is single-pair
    // In production, we'd modify BinanceClient to support multi-symbol
    if (!this.client['client']) throw new Error('Client not connected');

    const ticker = await this.client['client'].getSymbolPriceTicker({ symbol });
    if (Array.isArray(ticker)) {
      throw new Error('Unexpected response');
    }
    return parseFloat(String(ticker.price));
  }

  private async placeLimitOrderForSymbol(
    symbol: string,
    side: OrderSide,
    price: number,
    quantity: number,
    gridLevel: number
  ): Promise<Order | null> {
    if (!this.client['client']) throw new Error('Client not connected');

    const roundedPrice = this.client.roundPrice(price);
    const roundedQuantity = this.client.roundQuantity(quantity);

    const clientOrderId = `grid_${gridLevel}_${side}_${Date.now()}`;

    try {
      const result = await this.client['client'].submitNewOrder({
        symbol,
        side: side as 'BUY' | 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price: roundedPrice,
        quantity: roundedQuantity,
        newClientOrderId: clientOrderId,
      });

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

      return {
        orderId: orderResult.orderId.toString(),
        clientOrderId: orderResult.clientOrderId,
        tradingPair: orderResult.symbol,
        side: orderResult.side as OrderSide,
        orderType: orderResult.type,
        price: parseFloat(String(orderResult.price)),
        quantity: parseFloat(String(orderResult.origQty)),
        filledQuantity: parseFloat(String(orderResult.executedQty)),
        status: orderResult.status as Order['status'],
        gridLevel,
        createdAt: new Date(orderResult.transactTime),
      };
    } catch (error) {
      logger.error({ error, symbol, side, price, quantity }, 'Failed to place order');
      return null;
    }
  }

  // ===========================================================================
  // STATE & STATUS
  // ===========================================================================

  private lastSnapshotTime = 0;

  private updatePortfolioValue(): void {
    let totalValue = this.availableCapital;
    let totalPnl = 0;

    for (const [, pairBot] of this.pairBots) {
      totalValue += pairBot.positionValue;
      totalValue += pairBot.positionSize * pairBot.currentPrice;
      totalPnl += pairBot.realizedPnl + pairBot.unrealizedPnl;
    }

    this.riskManager.updatePortfolioValue(totalValue);

    // Save portfolio snapshot every 5 minutes
    const now = Date.now();
    if (now - this.lastSnapshotTime > 300000) {
      const riskStatus = this.riskManager.getStatus();
      tradingDb.savePortfolioSnapshot({
        totalValue,
        availableCapital: this.availableCapital,
        allocatedCapital: this.allocatedCapital,
        totalPnl,
        dailyPnl: riskStatus.dailyPnl,
        drawdown: riskStatus.drawdown,
        status: this.status,
      });
      this.lastSnapshotTime = now;
    }
  }

  getPortfolioState(): PortfolioState {
    const pairs = new Map<string, PairState>();

    for (const [symbol, pairBot] of this.pairBots) {
      pairs.set(symbol, {
        config: pairBot.config,
        status: pairBot.status,
        currentPrice: pairBot.currentPrice,
        gridLevels: pairBot.gridLevels,
        activeOrders: pairBot.activeOrders.size,
        positionSize: pairBot.positionSize,
        positionValue: pairBot.positionValue + pairBot.positionSize * pairBot.currentPrice,
        realizedPnl: pairBot.realizedPnl,
        unrealizedPnl: pairBot.unrealizedPnl,
        tradesCount: pairBot.tradesCount,
        lastUpdate: new Date(),
      });
    }

    return {
      status: this.status,
      startTime: this.startTime,
      totalCapital: this.config.totalCapital,
      availableCapital: this.availableCapital,
      allocatedCapital: this.allocatedCapital,
      pairs,
      riskMetrics: this.getRiskMetrics(),
      correlationMatrix: correlationAnalyzer.getCorrelationMatrix(),
      lastRebalance: null,
      pauseReason: this.riskManager.getStatus().pauseReason,
    };
  }

  getRiskMetrics(): PortfolioRiskMetrics {
    return this.riskManager.calculateRiskMetrics(this.getPortfolioState());
  }

  getStatus(): {
    status: PortfolioStatus;
    pairs: { symbol: string; status: string; price: number; pnl: number; trades: number }[];
    totalPnl: number;
    totalTrades: number;
    uptime: number;
    riskStatus: ReturnType<PortfolioRiskManager['getStatus']>;
    dataFeed: { type: 'websocket' | 'polling'; connected: boolean };
  } {
    const pairStatuses: { symbol: string; status: string; price: number; pnl: number; trades: number }[] = [];
    let totalPnl = 0;
    let totalTrades = 0;

    for (const [symbol, pairBot] of this.pairBots) {
      const pnl = pairBot.realizedPnl + pairBot.unrealizedPnl;
      pairStatuses.push({
        symbol,
        status: pairBot.status,
        price: pairBot.currentPrice,
        pnl,
        trades: pairBot.tradesCount,
      });
      totalPnl += pnl;
      totalTrades += pairBot.tradesCount;
    }

    return {
      status: this.status,
      pairs: pairStatuses,
      totalPnl,
      totalTrades,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime.getTime()) / 1000) : 0,
      riskStatus: this.riskManager.getStatus(),
      dataFeed: {
        type: this.useWebSocket ? 'websocket' : 'polling',
        connected: this.useWebSocket ? this.wsConnected : true,
      },
    };
  }

  getPairDetails(symbol: string): PairGridBot | undefined {
    return this.pairBots.get(symbol);
  }

  getAllPairs(): string[] {
    return Array.from(this.pairBots.keys());
  }

  // ===========================================================================
  // CONFIGURATION UPDATES
  // ===========================================================================

  async addPair(config: PairConfig): Promise<void> {
    if (this.pairBots.has(config.symbol)) {
      throw new Error(`Pair ${config.symbol} already exists`);
    }

    // Check correlation with existing pairs
    const existingPairs = Array.from(this.pairBots.keys());
    const corrCheck = correlationAnalyzer.wouldHurtDiversification(
      existingPairs,
      config.symbol,
      this.riskManager.getLimits().maxCorrelation
    );

    if (corrCheck.wouldHurt) {
      logger.warn({ symbol: config.symbol, reason: corrCheck.reason }, 'Adding highly correlated pair');
    }

    await this.initializePairBot(config);

    if (this.status === 'running') {
      const pairBot = this.pairBots.get(config.symbol);
      if (pairBot) {
        await this.startPairBot(config.symbol, pairBot);
      }
    }
  }

  async removePair(symbol: string): Promise<void> {
    const pairBot = this.pairBots.get(symbol);
    if (!pairBot) {
      throw new Error(`Pair ${symbol} not found`);
    }

    await this.stopPairBot(symbol, pairBot);

    // Return allocated capital
    this.availableCapital += pairBot.positionValue;
    this.allocatedCapital -= pairBot.positionValue;

    this.pairBots.delete(symbol);
    logger.info({ symbol }, 'Pair removed from portfolio');
  }

  updateRiskStrategy(strategy: RiskStrategy): void {
    this.riskManager.setStrategy(strategy);
    this.config.riskStrategy = strategy;
  }
}
