import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import type { GridLevelState } from '../types/portfolio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('database');

// Database file location
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/trading.db');

class TradingDatabase {
  private db: Database.Database | null = null;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(DB_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.db = new Database(DB_PATH);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      this.createTables();
      logger.info({ path: DB_PATH }, 'Database initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize database');
      throw error;
    }
  }

  private createTables(): void {
    if (!this.db) return;

    // Trades table - records all filled orders
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT UNIQUE,
        order_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        commission REAL DEFAULT 0,
        commission_asset TEXT,
        realized_pnl REAL DEFAULT 0,
        grid_level INTEGER,
        executed_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Grid state table - persists grid levels
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS grid_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        level INTEGER NOT NULL,
        price REAL NOT NULL,
        buy_order_id TEXT,
        sell_order_id TEXT,
        status TEXT NOT NULL,
        filled_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, level)
      )
    `);

    // Portfolio state - overall portfolio metrics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_value REAL NOT NULL,
        available_capital REAL NOT NULL,
        allocated_capital REAL NOT NULL,
        total_pnl REAL NOT NULL,
        daily_pnl REAL NOT NULL,
        drawdown REAL NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Pair states - per-pair metrics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pair_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        status TEXT NOT NULL,
        current_price REAL,
        position_size REAL DEFAULT 0,
        position_value REAL DEFAULT 0,
        realized_pnl REAL DEFAULT 0,
        unrealized_pnl REAL DEFAULT 0,
        trades_count INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol)
      )
    `);

    // Risk events - log circuit breakers and risk events
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS risk_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        symbol TEXT,
        description TEXT NOT NULL,
        value REAL,
        threshold REAL,
        action_taken TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Price history for correlation analysis
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp DATETIME NOT NULL,
        UNIQUE(symbol, timestamp)
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
      CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at);
      CREATE INDEX IF NOT EXISTS idx_grid_states_symbol ON grid_states(symbol);
      CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol);
      CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(timestamp);
    `);

    logger.debug('Database tables created');
  }

  // ==========================================================================
  // TRADE OPERATIONS
  // ==========================================================================

  saveTrade(trade: {
    tradeId: string;
    orderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    commission?: number;
    commissionAsset?: string;
    realizedPnl?: number;
    gridLevel?: number;
    executedAt: Date;
  }): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO trades (
        trade_id, order_id, symbol, side, price, quantity,
        commission, commission_asset, realized_pnl, grid_level, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trade.tradeId,
      trade.orderId,
      trade.symbol,
      trade.side,
      trade.price,
      trade.quantity,
      trade.commission || 0,
      trade.commissionAsset || null,
      trade.realizedPnl || 0,
      trade.gridLevel || null,
      trade.executedAt.toISOString()
    );
  }

  getTrades(symbol?: string, limit = 100): {
    tradeId: string;
    orderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    commission: number;
    realizedPnl: number;
    gridLevel: number | null;
    executedAt: Date;
  }[] {
    if (!this.db) return [];

    let query = 'SELECT * FROM trades';
    const params: (string | number)[] = [];

    if (symbol) {
      query += ' WHERE symbol = ?';
      params.push(symbol);
    }

    query += ' ORDER BY executed_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as {
      trade_id: string;
      order_id: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      price: number;
      quantity: number;
      commission: number;
      realized_pnl: number;
      grid_level: number | null;
      executed_at: string;
    }[];

    return rows.map(row => ({
      tradeId: row.trade_id,
      orderId: row.order_id,
      symbol: row.symbol,
      side: row.side,
      price: row.price,
      quantity: row.quantity,
      commission: row.commission,
      realizedPnl: row.realized_pnl,
      gridLevel: row.grid_level,
      executedAt: new Date(row.executed_at),
    }));
  }

  getDailyPnl(date: Date = new Date()): number {
    if (!this.db) return 0;

    const dateStr = date.toISOString().split('T')[0];
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(realized_pnl), 0) as total
      FROM trades
      WHERE DATE(executed_at) = DATE(?)
    `).get(dateStr) as { total: number };

    return result?.total || 0;
  }

  // ==========================================================================
  // GRID STATE OPERATIONS
  // ==========================================================================

  saveGridState(symbol: string, levels: GridLevelState[]): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO grid_states (
        symbol, level, price, buy_order_id, sell_order_id, status, filled_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const transaction = this.db.transaction(() => {
      for (const level of levels) {
        stmt.run(
          symbol,
          level.level,
          level.price,
          level.buyOrderId,
          level.sellOrderId,
          level.status,
          level.filledAt?.toISOString() || null
        );
      }
    });

    transaction();
    logger.debug({ symbol, levels: levels.length }, 'Grid state saved');
  }

  getGridState(symbol: string): GridLevelState[] {
    if (!this.db) return [];

    const rows = this.db.prepare(`
      SELECT level, price, buy_order_id, sell_order_id, status, filled_at
      FROM grid_states
      WHERE symbol = ?
      ORDER BY level
    `).all(symbol) as {
      level: number;
      price: number;
      buy_order_id: string | null;
      sell_order_id: string | null;
      status: string;
      filled_at: string | null;
    }[];

    return rows.map(row => ({
      level: row.level,
      price: row.price,
      buyOrderId: row.buy_order_id,
      sellOrderId: row.sell_order_id,
      status: row.status as GridLevelState['status'],
      filledAt: row.filled_at ? new Date(row.filled_at) : null,
    }));
  }

  clearGridState(symbol: string): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM grid_states WHERE symbol = ?').run(symbol);
  }

  // ==========================================================================
  // PAIR STATE OPERATIONS
  // ==========================================================================

  savePairState(state: {
    symbol: string;
    status: string;
    currentPrice: number;
    positionSize: number;
    positionValue: number;
    realizedPnl: number;
    unrealizedPnl: number;
    tradesCount: number;
  }): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT OR REPLACE INTO pair_states (
        symbol, status, current_price, position_size, position_value,
        realized_pnl, unrealized_pnl, trades_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      state.symbol,
      state.status,
      state.currentPrice,
      state.positionSize,
      state.positionValue,
      state.realizedPnl,
      state.unrealizedPnl,
      state.tradesCount
    );
  }

  getPairState(symbol: string): {
    symbol: string;
    status: string;
    currentPrice: number;
    positionSize: number;
    positionValue: number;
    realizedPnl: number;
    unrealizedPnl: number;
    tradesCount: number;
  } | null {
    if (!this.db) return null;

    const row = this.db.prepare(`
      SELECT * FROM pair_states WHERE symbol = ?
    `).get(symbol) as {
      symbol: string;
      status: string;
      current_price: number;
      position_size: number;
      position_value: number;
      realized_pnl: number;
      unrealized_pnl: number;
      trades_count: number;
    } | undefined;

    if (!row) return null;

    return {
      symbol: row.symbol,
      status: row.status,
      currentPrice: row.current_price,
      positionSize: row.position_size,
      positionValue: row.position_value,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      tradesCount: row.trades_count,
    };
  }

  getAllPairStates(): {
    symbol: string;
    status: string;
    currentPrice: number;
    positionSize: number;
    positionValue: number;
    realizedPnl: number;
    unrealizedPnl: number;
    tradesCount: number;
  }[] {
    if (!this.db) return [];

    const rows = this.db.prepare('SELECT * FROM pair_states').all() as {
      symbol: string;
      status: string;
      current_price: number;
      position_size: number;
      position_value: number;
      realized_pnl: number;
      unrealized_pnl: number;
      trades_count: number;
    }[];

    return rows.map(row => ({
      symbol: row.symbol,
      status: row.status,
      currentPrice: row.current_price,
      positionSize: row.position_size,
      positionValue: row.position_value,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      tradesCount: row.trades_count,
    }));
  }

  // ==========================================================================
  // PORTFOLIO SNAPSHOT OPERATIONS
  // ==========================================================================

  savePortfolioSnapshot(snapshot: {
    totalValue: number;
    availableCapital: number;
    allocatedCapital: number;
    totalPnl: number;
    dailyPnl: number;
    drawdown: number;
    status: string;
  }): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT INTO portfolio_snapshots (
        total_value, available_capital, allocated_capital,
        total_pnl, daily_pnl, drawdown, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.totalValue,
      snapshot.availableCapital,
      snapshot.allocatedCapital,
      snapshot.totalPnl,
      snapshot.dailyPnl,
      snapshot.drawdown,
      snapshot.status
    );
  }

  getLatestPortfolioSnapshot(): {
    totalValue: number;
    availableCapital: number;
    allocatedCapital: number;
    totalPnl: number;
    dailyPnl: number;
    drawdown: number;
    status: string;
    createdAt: Date;
  } | null {
    if (!this.db) return null;

    const row = this.db.prepare(`
      SELECT * FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1
    `).get() as {
      total_value: number;
      available_capital: number;
      allocated_capital: number;
      total_pnl: number;
      daily_pnl: number;
      drawdown: number;
      status: string;
      created_at: string;
    } | undefined;

    if (!row) return null;

    return {
      totalValue: row.total_value,
      availableCapital: row.available_capital,
      allocatedCapital: row.allocated_capital,
      totalPnl: row.total_pnl,
      dailyPnl: row.daily_pnl,
      drawdown: row.drawdown,
      status: row.status,
      createdAt: new Date(row.created_at),
    };
  }

  // ==========================================================================
  // RISK EVENT OPERATIONS
  // ==========================================================================

  logRiskEvent(event: {
    eventType: string;
    symbol?: string;
    description: string;
    value?: number;
    threshold?: number;
    actionTaken?: string;
  }): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT INTO risk_events (
        event_type, symbol, description, value, threshold, action_taken
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.eventType,
      event.symbol || null,
      event.description,
      event.value || null,
      event.threshold || null,
      event.actionTaken || null
    );

    logger.info({ event }, 'Risk event logged');
  }

  getRecentRiskEvents(limit = 50): {
    eventType: string;
    symbol: string | null;
    description: string;
    value: number | null;
    threshold: number | null;
    actionTaken: string | null;
    createdAt: Date;
  }[] {
    if (!this.db) return [];

    const rows = this.db.prepare(`
      SELECT * FROM risk_events ORDER BY created_at DESC LIMIT ?
    `).all(limit) as {
      event_type: string;
      symbol: string | null;
      description: string;
      value: number | null;
      threshold: number | null;
      action_taken: string | null;
      created_at: string;
    }[];

    return rows.map(row => ({
      eventType: row.event_type,
      symbol: row.symbol,
      description: row.description,
      value: row.value,
      threshold: row.threshold,
      actionTaken: row.action_taken,
      createdAt: new Date(row.created_at),
    }));
  }

  // ==========================================================================
  // PRICE HISTORY OPERATIONS
  // ==========================================================================

  savePricePoint(symbol: string, price: number, timestamp: Date = new Date()): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT OR IGNORE INTO price_history (symbol, price, timestamp)
      VALUES (?, ?, ?)
    `).run(symbol, price, timestamp.toISOString());
  }

  getPriceHistory(symbol: string, days = 30): { timestamp: number; price: number }[] {
    if (!this.db) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const rows = this.db.prepare(`
      SELECT price, timestamp FROM price_history
      WHERE symbol = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `).all(symbol, cutoff.toISOString()) as {
      price: number;
      timestamp: string;
    }[];

    return rows.map(row => ({
      timestamp: new Date(row.timestamp).getTime(),
      price: row.price,
    }));
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  getTradeStats(symbol?: string): {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    avgPnl: number;
    winRate: number;
  } {
    if (!this.db) return { totalTrades: 0, winningTrades: 0, losingTrades: 0, totalPnl: 0, avgPnl: 0, winRate: 0 };

    let query = `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN realized_pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
        COALESCE(SUM(realized_pnl), 0) as total_pnl,
        COALESCE(AVG(realized_pnl), 0) as avg_pnl
      FROM trades
    `;

    if (symbol) {
      query += ' WHERE symbol = ?';
      const result = this.db.prepare(query).get(symbol) as {
        total_trades: number;
        winning_trades: number;
        losing_trades: number;
        total_pnl: number;
        avg_pnl: number;
      };

      return {
        totalTrades: result.total_trades,
        winningTrades: result.winning_trades,
        losingTrades: result.losing_trades,
        totalPnl: result.total_pnl,
        avgPnl: result.avg_pnl,
        winRate: result.total_trades > 0 ? (result.winning_trades / result.total_trades) * 100 : 0,
      };
    }

    const result = this.db.prepare(query).get() as {
      total_trades: number;
      winning_trades: number;
      losing_trades: number;
      total_pnl: number;
      avg_pnl: number;
    };

    return {
      totalTrades: result.total_trades,
      winningTrades: result.winning_trades,
      losingTrades: result.losing_trades,
      totalPnl: result.total_pnl,
      avgPnl: result.avg_pnl,
      winRate: result.total_trades > 0 ? (result.winning_trades / result.total_trades) * 100 : 0,
    };
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database closed');
    }
  }
}

// Singleton instance
export const tradingDb = new TradingDatabase();

// Export for cleanup on process exit
process.on('exit', () => tradingDb.close());
process.on('SIGINT', () => { tradingDb.close(); process.exit(0); });
process.on('SIGTERM', () => { tradingDb.close(); process.exit(0); });
