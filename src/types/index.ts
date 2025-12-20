import { z } from 'zod';

// Grid Configuration Schema
export const GridConfigSchema = z.object({
  tradingPair: z.string().default('BTCUSDT'),
  upperPrice: z.number().positive(),
  lowerPrice: z.number().positive(),
  gridCount: z.number().int().min(2).max(100),
  amountPerGrid: z.number().positive(),
  gridType: z.enum(['arithmetic', 'geometric']).default('arithmetic'),
});

export type GridConfig = z.infer<typeof GridConfigSchema>;

// Order Types
export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED';

export interface Order {
  orderId: string;
  clientOrderId?: string;
  tradingPair: string;
  side: OrderSide;
  orderType: string;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  gridLevel?: number;
  createdAt: Date;
}

export interface Trade {
  tradeId: string;
  orderId: string;
  tradingPair: string;
  side: OrderSide;
  price: number;
  quantity: number;
  commission: number;
  commissionAsset?: string;
  realizedPnl: number;
  createdAt: Date;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface GridLevel {
  level: number;
  price: number;
  buyOrderId: string | null;
  sellOrderId: string | null;
  status: 'empty' | 'buy_pending' | 'bought' | 'sell_pending' | 'sold';
}

export type BotStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface DashboardData {
  status: BotStatus;
  balances: Balance[];
  gridLevels: GridLevel[];
  recentTrades: Trade[];
  openOrders: Order[];
}

// WebSocket Message Types
export type WsMessageType = 'status' | 'price' | 'order' | 'trade' | 'ping' | 'pong';

export interface WsMessage {
  type: WsMessageType;
  data?: unknown;
}

// Risk Limits
export interface RiskLimits {
  maxPositionSize: number;
  maxOpenOrders: number;
  dailyLossLimit: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxConsecutiveLosses: number;
  maxDrawdownPercent: number;
}

export interface RiskMetrics {
  totalExposure: number;
  dailyPnl: number;
  drawdown: number;
  maxDrawdown: number;
  consecutiveLosses: number;
  stopLossTriggered: boolean;
  takeProfitTriggered: boolean;
}
