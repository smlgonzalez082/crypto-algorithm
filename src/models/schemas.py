"""Data models and database schemas."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Float, Integer, String, Boolean, Text, func
from sqlalchemy.orm import DeclarativeBase


# SQLAlchemy Models
class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""
    pass


class GridConfigDB(Base):
    """Grid configuration stored in database."""

    __tablename__ = "grid_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trading_pair = Column(String(20), nullable=False)
    upper_price = Column(Float, nullable=False)
    lower_price = Column(Float, nullable=False)
    grid_count = Column(Integer, nullable=False)
    amount_per_grid = Column(Float, nullable=False)
    grid_type = Column(String(20), default="arithmetic")
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class OrderDB(Base):
    """Order record in database."""

    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String(50), unique=True, nullable=False)
    client_order_id = Column(String(50), nullable=True)
    trading_pair = Column(String(20), nullable=False)
    side = Column(String(10), nullable=False)  # BUY or SELL
    order_type = Column(String(20), nullable=False)
    price = Column(Float, nullable=False)
    quantity = Column(Float, nullable=False)
    filled_quantity = Column(Float, default=0.0)
    status = Column(String(20), nullable=False)
    grid_level = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TradeDB(Base):
    """Trade execution record."""

    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trade_id = Column(String(50), unique=True, nullable=False)
    order_id = Column(String(50), nullable=False)
    trading_pair = Column(String(20), nullable=False)
    side = Column(String(10), nullable=False)
    price = Column(Float, nullable=False)
    quantity = Column(Float, nullable=False)
    commission = Column(Float, default=0.0)
    commission_asset = Column(String(10), nullable=True)
    realized_pnl = Column(Float, default=0.0)
    created_at = Column(DateTime, server_default=func.now())


class BotStateDB(Base):
    """Bot state persistence."""

    __tablename__ = "bot_state"

    id = Column(Integer, primary_key=True, autoincrement=True)
    is_running = Column(Boolean, default=False)
    current_price = Column(Float, nullable=True)
    total_profit = Column(Float, default=0.0)
    total_trades = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# Pydantic Models for API
class OrderSide(str, Enum):
    """Order side enum."""
    BUY = "BUY"
    SELL = "SELL"


class OrderStatus(str, Enum):
    """Order status enum."""
    NEW = "NEW"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class GridConfig(BaseModel):
    """Grid configuration model."""
    trading_pair: str = "BTCUSDT"
    upper_price: float = Field(gt=0)
    lower_price: float = Field(gt=0)
    grid_count: int = Field(ge=2, le=100)
    amount_per_grid: float = Field(gt=0)
    grid_type: str = "arithmetic"

    def get_grid_levels(self) -> list[float]:
        """Generate grid price levels."""
        levels = []
        if self.grid_type == "geometric":
            ratio = (self.upper_price / self.lower_price) ** (1 / self.grid_count)
            for i in range(self.grid_count + 1):
                levels.append(self.lower_price * (ratio ** i))
        else:
            spacing = (self.upper_price - self.lower_price) / self.grid_count
            for i in range(self.grid_count + 1):
                levels.append(self.lower_price + (spacing * i))
        return levels


class Order(BaseModel):
    """Order model."""
    order_id: str
    client_order_id: Optional[str] = None
    trading_pair: str
    side: OrderSide
    order_type: str = "LIMIT"
    price: float
    quantity: float
    filled_quantity: float = 0.0
    status: OrderStatus = OrderStatus.NEW
    grid_level: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Trade(BaseModel):
    """Trade execution model."""
    trade_id: str
    order_id: str
    trading_pair: str
    side: OrderSide
    price: float
    quantity: float
    commission: float = 0.0
    commission_asset: Optional[str] = None
    realized_pnl: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Balance(BaseModel):
    """Account balance model."""
    asset: str
    free: float
    locked: float

    @property
    def total(self) -> float:
        return self.free + self.locked


class BotStatus(BaseModel):
    """Bot status model."""
    is_running: bool = False
    simulation_mode: bool = True
    trading_pair: str = ""
    current_price: Optional[float] = None
    grid_config: Optional[GridConfig] = None
    open_orders: int = 0
    total_trades: int = 0
    total_profit: float = 0.0
    daily_profit: float = 0.0
    uptime_seconds: int = 0
    last_error: Optional[str] = None


class GridLevel(BaseModel):
    """Grid level status."""
    level: int
    price: float
    has_buy_order: bool = False
    has_sell_order: bool = False
    buy_order_id: Optional[str] = None
    sell_order_id: Optional[str] = None


class DashboardData(BaseModel):
    """Complete dashboard data model."""
    status: BotStatus
    balances: list[Balance] = []
    grid_levels: list[GridLevel] = []
    recent_trades: list[Trade] = []
    open_orders: list[Order] = []
    price_history: list[dict] = []
