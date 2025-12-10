"""Risk management module."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from src.models.schemas import Order, OrderSide, GridConfig
from src.utils.config import get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class RiskMetrics:
    """Current risk metrics."""
    total_exposure: float = 0.0
    max_exposure: float = 0.0
    daily_pnl: float = 0.0
    daily_loss_limit: float = 0.0
    drawdown: float = 0.0
    max_drawdown: float = 0.0
    consecutive_losses: int = 0
    stop_loss_triggered: bool = False
    take_profit_triggered: bool = False


@dataclass
class RiskLimits:
    """Risk limit configuration."""
    max_position_size: float = 0.1
    max_open_orders: int = 50
    daily_loss_limit: float = 100.0
    stop_loss_percent: float = 5.0
    take_profit_percent: float = 10.0
    max_consecutive_losses: int = 5
    max_drawdown_percent: float = 10.0


class RiskManager:
    """Risk management for grid trading."""

    def __init__(self, limits: Optional[RiskLimits] = None):
        settings = get_settings()

        if limits:
            self.limits = limits
        else:
            self.limits = RiskLimits(
                max_position_size=settings.max_position_size,
                max_open_orders=settings.max_open_orders,
                daily_loss_limit=settings.daily_loss_limit,
                stop_loss_percent=settings.stop_loss_percent,
            )

        self._metrics = RiskMetrics(
            daily_loss_limit=self.limits.daily_loss_limit,
        )

        # Tracking
        self._daily_trades: list[float] = []
        self._peak_balance: float = 0.0
        self._current_balance: float = 0.0
        self._last_reset: datetime = datetime.utcnow()

    @property
    def metrics(self) -> RiskMetrics:
        return self._metrics

    def update_balance(self, balance: float) -> None:
        """Update current balance and track drawdown."""
        self._current_balance = balance

        if balance > self._peak_balance:
            self._peak_balance = balance

        if self._peak_balance > 0:
            self._metrics.drawdown = (
                (self._peak_balance - balance) / self._peak_balance
            ) * 100

            if self._metrics.drawdown > self._metrics.max_drawdown:
                self._metrics.max_drawdown = self._metrics.drawdown

    def record_trade_pnl(self, pnl: float) -> None:
        """Record a trade's P&L."""
        self._daily_trades.append(pnl)
        self._metrics.daily_pnl = sum(self._daily_trades)

        if pnl < 0:
            self._metrics.consecutive_losses += 1
        else:
            self._metrics.consecutive_losses = 0

    def can_place_order(
        self,
        side: OrderSide,
        quantity: float,
        price: float,
        current_open_orders: int,
    ) -> tuple[bool, str]:
        """
        Check if an order can be placed based on risk limits.

        Returns:
            Tuple of (allowed, reason)
        """
        # Check daily loss limit
        if self._metrics.daily_pnl <= -self.limits.daily_loss_limit:
            return False, "Daily loss limit reached"

        # Check max open orders
        if current_open_orders >= self.limits.max_open_orders:
            return False, f"Max open orders ({self.limits.max_open_orders}) reached"

        # Check position size
        order_value = quantity * price
        if order_value > self.limits.max_position_size * self._current_balance:
            return False, "Order exceeds max position size"

        # Check consecutive losses
        if self._metrics.consecutive_losses >= self.limits.max_consecutive_losses:
            return False, f"Max consecutive losses ({self.limits.max_consecutive_losses}) reached"

        # Check drawdown
        if self._metrics.drawdown >= self.limits.max_drawdown_percent:
            return False, f"Max drawdown ({self.limits.max_drawdown_percent}%) reached"

        return True, "OK"

    def check_stop_loss(
        self,
        current_price: float,
        grid_config: GridConfig,
    ) -> bool:
        """
        Check if stop loss should be triggered.

        Returns True if stop loss should trigger.
        """
        stop_loss_price = grid_config.lower_price * (
            1 - self.limits.stop_loss_percent / 100
        )

        if current_price <= stop_loss_price:
            self._metrics.stop_loss_triggered = True
            logger.warning(
                "stop_loss_triggered",
                current_price=current_price,
                stop_loss_price=stop_loss_price,
            )
            return True

        return False

    def check_take_profit(
        self,
        current_price: float,
        grid_config: GridConfig,
    ) -> bool:
        """
        Check if take profit should be triggered.

        Returns True if take profit should trigger.
        """
        take_profit_price = grid_config.upper_price * (
            1 + self.limits.take_profit_percent / 100
        )

        if current_price >= take_profit_price:
            self._metrics.take_profit_triggered = True
            logger.info(
                "take_profit_triggered",
                current_price=current_price,
                take_profit_price=take_profit_price,
            )
            return True

        return False

    def reset_daily_metrics(self) -> None:
        """Reset daily metrics (call at start of new trading day)."""
        self._daily_trades.clear()
        self._metrics.daily_pnl = 0.0
        self._metrics.stop_loss_triggered = False
        self._metrics.take_profit_triggered = False
        self._last_reset = datetime.utcnow()
        logger.info("daily_metrics_reset")

    def should_reset_daily(self) -> bool:
        """Check if daily metrics should be reset."""
        now = datetime.utcnow()
        return now.date() > self._last_reset.date()

    def get_risk_report(self) -> dict:
        """Get a summary risk report."""
        return {
            "daily_pnl": self._metrics.daily_pnl,
            "daily_loss_limit": self.limits.daily_loss_limit,
            "daily_pnl_percent": (
                (self._metrics.daily_pnl / self.limits.daily_loss_limit) * 100
                if self.limits.daily_loss_limit > 0
                else 0
            ),
            "current_drawdown": self._metrics.drawdown,
            "max_drawdown": self._metrics.max_drawdown,
            "consecutive_losses": self._metrics.consecutive_losses,
            "stop_loss_triggered": self._metrics.stop_loss_triggered,
            "take_profit_triggered": self._metrics.take_profit_triggered,
            "risk_status": self._get_risk_status(),
        }

    def _get_risk_status(self) -> str:
        """Get overall risk status."""
        if self._metrics.stop_loss_triggered:
            return "STOPPED"
        if self._metrics.drawdown >= self.limits.max_drawdown_percent * 0.8:
            return "HIGH_RISK"
        if self._metrics.daily_pnl <= -self.limits.daily_loss_limit * 0.8:
            return "HIGH_RISK"
        if self._metrics.consecutive_losses >= self.limits.max_consecutive_losses - 1:
            return "WARNING"
        if self._metrics.drawdown >= self.limits.max_drawdown_percent * 0.5:
            return "MODERATE"
        return "NORMAL"
