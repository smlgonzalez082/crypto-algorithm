"""Grid trading strategy implementation."""

import asyncio
from datetime import datetime, timedelta
from typing import Optional

from src.exchange.binance import BinanceClient
from src.models.schemas import (
    GridConfig,
    GridLevel,
    Order,
    OrderSide,
    OrderStatus,
    BotStatus,
    Trade,
)
from src.utils.config import get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class GridBot:
    """Grid trading bot implementation."""

    def __init__(
        self,
        client: BinanceClient,
        config: Optional[GridConfig] = None,
        simulation_mode: bool = True,
    ):
        self.client = client
        self.settings = get_settings()
        self.simulation_mode = simulation_mode

        # Initialize grid config from settings if not provided
        if config:
            self.config = config
        else:
            self.config = GridConfig(
                trading_pair=self.settings.trading_pair,
                upper_price=self.settings.grid_upper,
                lower_price=self.settings.grid_lower,
                grid_count=self.settings.grid_count,
                amount_per_grid=self.settings.grid_amount,
                grid_type=self.settings.grid_type,
            )

        # State
        self._running = False
        self._start_time: Optional[datetime] = None
        self._current_price: Optional[float] = None
        self._grid_levels: list[GridLevel] = []
        self._open_orders: dict[str, Order] = {}
        self._trades: list[Trade] = []
        self._total_profit: float = 0.0
        self._daily_profit: float = 0.0
        self._last_error: Optional[str] = None

        # Simulation state
        self._sim_orders: dict[str, Order] = {}
        self._sim_balance_base: float = 0.0
        self._sim_balance_quote: float = 10000.0  # Start with 10k USDT

        # Callbacks for UI updates
        self._status_callbacks: list = []

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def grid_levels(self) -> list[GridLevel]:
        return self._grid_levels

    @property
    def current_price(self) -> Optional[float]:
        return self._current_price

    def get_status(self) -> BotStatus:
        """Get current bot status."""
        uptime = 0
        if self._start_time:
            uptime = int((datetime.utcnow() - self._start_time).total_seconds())

        return BotStatus(
            is_running=self._running,
            simulation_mode=self.simulation_mode,
            trading_pair=self.config.trading_pair,
            current_price=self._current_price,
            grid_config=self.config,
            open_orders=len(self._open_orders),
            total_trades=len(self._trades),
            total_profit=self._total_profit,
            daily_profit=self._daily_profit,
            uptime_seconds=uptime,
            last_error=self._last_error,
        )

    def on_status_update(self, callback) -> None:
        """Register callback for status updates."""
        self._status_callbacks.append(callback)

    async def _notify_status(self) -> None:
        """Notify all status callbacks."""
        status = self.get_status()
        for callback in self._status_callbacks:
            try:
                await callback(status)
            except Exception as e:
                logger.error("status_callback_error", error=str(e))

    def _initialize_grid_levels(self) -> None:
        """Initialize grid levels from config."""
        prices = self.config.get_grid_levels()
        self._grid_levels = [
            GridLevel(
                level=i,
                price=price,
                has_buy_order=False,
                has_sell_order=False,
            )
            for i, price in enumerate(prices)
        ]
        logger.info(
            "grid_initialized",
            levels=len(self._grid_levels),
            lower=prices[0],
            upper=prices[-1],
        )

    async def start(self) -> None:
        """Start the grid bot."""
        if self._running:
            logger.warning("bot_already_running")
            return

        logger.info(
            "bot_starting",
            simulation=self.simulation_mode,
            pair=self.config.trading_pair,
        )

        try:
            self._running = True
            self._start_time = datetime.utcnow()
            self._last_error = None

            # Initialize grid levels
            self._initialize_grid_levels()

            # Get current price
            if self.simulation_mode:
                self._current_price = (self.config.upper_price + self.config.lower_price) / 2
            else:
                self._current_price = await self.client.get_current_price()

            # Register callbacks
            self.client.on_price_update(self._on_price_update)
            self.client.on_order_update(self._on_order_update)

            # Place initial grid orders
            await self._place_initial_orders()

            # Start main loop
            if not self.simulation_mode:
                asyncio.create_task(self.client.start_price_stream())
                asyncio.create_task(self.client.start_user_stream())

            await self._notify_status()
            logger.info("bot_started")

        except Exception as e:
            self._running = False
            self._last_error = str(e)
            logger.error("bot_start_failed", error=str(e))
            raise

    async def stop(self) -> None:
        """Stop the grid bot."""
        if not self._running:
            return

        logger.info("bot_stopping")
        self._running = False

        # Cancel all open orders
        if not self.simulation_mode:
            await self.client.cancel_all_orders()

        self._open_orders.clear()
        await self._notify_status()
        logger.info("bot_stopped")

    async def _place_initial_orders(self) -> None:
        """Place initial buy and sell orders on the grid."""
        if not self._current_price:
            raise RuntimeError("Current price not available")

        logger.info("placing_initial_orders", current_price=self._current_price)

        for level in self._grid_levels:
            if level.price < self._current_price:
                # Place buy order below current price
                await self._place_buy_order(level)
            elif level.price > self._current_price:
                # Place sell order above current price
                await self._place_sell_order(level)
            # Skip level closest to current price

    async def _place_buy_order(self, level: GridLevel) -> Optional[Order]:
        """Place a buy order at the given grid level."""
        if level.has_buy_order:
            return None

        try:
            if self.simulation_mode:
                order = await self._simulate_place_order(
                    OrderSide.BUY,
                    level.price,
                    self.config.amount_per_grid,
                    level.level,
                )
            else:
                order = await self.client.place_limit_order(
                    side=OrderSide.BUY,
                    price=level.price,
                    quantity=self.config.amount_per_grid,
                    grid_level=level.level,
                )

            level.has_buy_order = True
            level.buy_order_id = order.order_id
            self._open_orders[order.order_id] = order

            logger.debug(
                "buy_order_placed",
                level=level.level,
                price=level.price,
                order_id=order.order_id,
            )

            return order

        except Exception as e:
            logger.error(
                "buy_order_failed",
                level=level.level,
                price=level.price,
                error=str(e),
            )
            return None

    async def _place_sell_order(self, level: GridLevel) -> Optional[Order]:
        """Place a sell order at the given grid level."""
        if level.has_sell_order:
            return None

        try:
            if self.simulation_mode:
                order = await self._simulate_place_order(
                    OrderSide.SELL,
                    level.price,
                    self.config.amount_per_grid,
                    level.level,
                )
            else:
                order = await self.client.place_limit_order(
                    side=OrderSide.SELL,
                    price=level.price,
                    quantity=self.config.amount_per_grid,
                    grid_level=level.level,
                )

            level.has_sell_order = True
            level.sell_order_id = order.order_id
            self._open_orders[order.order_id] = order

            logger.debug(
                "sell_order_placed",
                level=level.level,
                price=level.price,
                order_id=order.order_id,
            )

            return order

        except Exception as e:
            logger.error(
                "sell_order_failed",
                level=level.level,
                price=level.price,
                error=str(e),
            )
            return None

    async def _on_price_update(self, price: float) -> None:
        """Handle price update from WebSocket."""
        self._current_price = price

        if self.simulation_mode:
            await self._check_simulated_fills(price)

        await self._notify_status()

    async def _on_order_update(self, order: Order) -> None:
        """Handle order update from WebSocket."""
        if order.order_id not in self._open_orders:
            return

        # Update our local order state
        self._open_orders[order.order_id] = order

        if order.status == OrderStatus.FILLED:
            await self._handle_filled_order(order)

    async def _handle_filled_order(self, order: Order) -> None:
        """Handle a filled order - place counter order."""
        logger.info(
            "order_filled",
            order_id=order.order_id,
            side=order.side.value,
            price=order.price,
            level=order.grid_level,
        )

        # Remove from open orders
        del self._open_orders[order.order_id]

        # Record trade
        trade = Trade(
            trade_id=f"trade_{len(self._trades)}",
            order_id=order.order_id,
            trading_pair=order.trading_pair,
            side=order.side,
            price=order.price,
            quantity=order.quantity,
        )
        self._trades.append(trade)

        # Find the grid level
        if order.grid_level is None:
            return

        level = self._grid_levels[order.grid_level]

        if order.side == OrderSide.BUY:
            # Buy filled - place sell one level up
            level.has_buy_order = False
            level.buy_order_id = None

            # Calculate profit (will be realized when sell fills)
            if order.grid_level + 1 < len(self._grid_levels):
                next_level = self._grid_levels[order.grid_level + 1]
                await self._place_sell_order(next_level)

        elif order.side == OrderSide.SELL:
            # Sell filled - place buy one level down
            level.has_sell_order = False
            level.sell_order_id = None

            # Calculate realized profit
            grid_spacing = self.config.get_grid_levels()
            if len(grid_spacing) > 1:
                spacing = grid_spacing[1] - grid_spacing[0]
                profit = spacing * order.quantity
                self._total_profit += profit
                self._daily_profit += profit
                logger.info("profit_realized", profit=profit, total=self._total_profit)

            if order.grid_level - 1 >= 0:
                prev_level = self._grid_levels[order.grid_level - 1]
                await self._place_buy_order(prev_level)

        await self._notify_status()

    # Simulation methods
    async def _simulate_place_order(
        self,
        side: OrderSide,
        price: float,
        quantity: float,
        grid_level: int,
    ) -> Order:
        """Simulate placing an order."""
        import time

        order_id = f"sim_{int(time.time() * 1000)}_{grid_level}_{side.value}"

        order = Order(
            order_id=order_id,
            client_order_id=f"grid_{grid_level}_{side.value}",
            trading_pair=self.config.trading_pair,
            side=side,
            order_type="LIMIT",
            price=price,
            quantity=quantity,
            status=OrderStatus.NEW,
            grid_level=grid_level,
        )

        self._sim_orders[order_id] = order
        return order

    async def _check_simulated_fills(self, current_price: float) -> None:
        """Check if any simulated orders should be filled."""
        filled_orders = []

        for order_id, order in self._sim_orders.items():
            if order.status != OrderStatus.NEW:
                continue

            should_fill = False
            if order.side == OrderSide.BUY and current_price <= order.price:
                should_fill = True
            elif order.side == OrderSide.SELL and current_price >= order.price:
                should_fill = True

            if should_fill:
                order.status = OrderStatus.FILLED
                order.filled_quantity = order.quantity
                filled_orders.append(order)

        for order in filled_orders:
            await self._handle_filled_order(order)

    async def simulate_price_movement(self, new_price: float) -> None:
        """Simulate price movement for testing."""
        if not self.simulation_mode:
            raise RuntimeError("Not in simulation mode")

        await self._on_price_update(new_price)

    def update_config(self, config: GridConfig) -> None:
        """Update grid configuration (requires restart)."""
        if self._running:
            raise RuntimeError("Cannot update config while bot is running")
        self.config = config

    def get_open_orders(self) -> list[Order]:
        """Get list of open orders."""
        return list(self._open_orders.values())

    def get_trades(self) -> list[Trade]:
        """Get list of executed trades."""
        return self._trades.copy()
