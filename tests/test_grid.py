"""Tests for grid trading logic."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from src.models.schemas import GridConfig, OrderSide, OrderStatus, Order, GridLevel
from src.bot.grid import GridBot
from src.bot.risk import RiskManager, RiskLimits


class TestGridConfig:
    """Tests for GridConfig model."""

    def test_arithmetic_grid_levels(self):
        """Test arithmetic grid level generation."""
        config = GridConfig(
            trading_pair="BTCUSDT",
            upper_price=45000,
            lower_price=40000,
            grid_count=10,
            amount_per_grid=0.001,
            grid_type="arithmetic",
        )

        levels = config.get_grid_levels()

        assert len(levels) == 11  # grid_count + 1
        assert levels[0] == 40000
        assert levels[-1] == 45000
        # Check equal spacing
        spacing = levels[1] - levels[0]
        assert spacing == 500  # (45000 - 40000) / 10

    def test_geometric_grid_levels(self):
        """Test geometric grid level generation."""
        config = GridConfig(
            trading_pair="BTCUSDT",
            upper_price=50000,
            lower_price=40000,
            grid_count=10,
            amount_per_grid=0.001,
            grid_type="geometric",
        )

        levels = config.get_grid_levels()

        assert len(levels) == 11
        assert levels[0] == pytest.approx(40000, rel=0.001)
        assert levels[-1] == pytest.approx(50000, rel=0.001)
        # Check geometric ratio
        ratio = levels[1] / levels[0]
        for i in range(1, len(levels)):
            assert levels[i] / levels[i - 1] == pytest.approx(ratio, rel=0.001)

    def test_validation_grid_count_minimum(self):
        """Test that grid count must be at least 2."""
        with pytest.raises(ValueError):
            GridConfig(
                trading_pair="BTCUSDT",
                upper_price=45000,
                lower_price=40000,
                grid_count=1,
                amount_per_grid=0.001,
            )

    def test_validation_grid_count_maximum(self):
        """Test that grid count cannot exceed 100."""
        with pytest.raises(ValueError):
            GridConfig(
                trading_pair="BTCUSDT",
                upper_price=45000,
                lower_price=40000,
                grid_count=101,
                amount_per_grid=0.001,
            )

    def test_validation_positive_prices(self):
        """Test that prices must be positive."""
        with pytest.raises(ValueError):
            GridConfig(
                trading_pair="BTCUSDT",
                upper_price=-45000,
                lower_price=40000,
                grid_count=10,
                amount_per_grid=0.001,
            )

    def test_validation_positive_amount(self):
        """Test that amount must be positive."""
        with pytest.raises(ValueError):
            GridConfig(
                trading_pair="BTCUSDT",
                upper_price=45000,
                lower_price=40000,
                grid_count=10,
                amount_per_grid=0,
            )


class TestOrderSide:
    """Tests for OrderSide enum."""

    def test_order_sides(self):
        """Test order side values."""
        assert OrderSide.BUY.value == "BUY"
        assert OrderSide.SELL.value == "SELL"


class TestOrderStatus:
    """Tests for OrderStatus enum."""

    def test_order_statuses(self):
        """Test order status values."""
        assert OrderStatus.NEW.value == "NEW"
        assert OrderStatus.FILLED.value == "FILLED"
        assert OrderStatus.CANCELED.value == "CANCELED"
        assert OrderStatus.PARTIALLY_FILLED.value == "PARTIALLY_FILLED"


class TestOrder:
    """Tests for Order model."""

    def test_order_creation(self):
        """Test creating an order."""
        order = Order(
            order_id="123",
            trading_pair="BTCUSDT",
            side=OrderSide.BUY,
            price=42000,
            quantity=0.001,
        )

        assert order.order_id == "123"
        assert order.trading_pair == "BTCUSDT"
        assert order.side == OrderSide.BUY
        assert order.price == 42000
        assert order.quantity == 0.001
        assert order.status == OrderStatus.NEW
        assert order.filled_quantity == 0.0

    def test_order_with_grid_level(self):
        """Test creating an order with grid level."""
        order = Order(
            order_id="456",
            trading_pair="BTCUSDT",
            side=OrderSide.SELL,
            price=43000,
            quantity=0.001,
            grid_level=5,
        )

        assert order.grid_level == 5


class TestGridLevel:
    """Tests for GridLevel model."""

    def test_grid_level_creation(self):
        """Test creating a grid level."""
        level = GridLevel(
            level=0,
            price=40000,
        )

        assert level.level == 0
        assert level.price == 40000
        assert level.has_buy_order is False
        assert level.has_sell_order is False

    def test_grid_level_with_orders(self):
        """Test grid level with active orders."""
        level = GridLevel(
            level=5,
            price=42500,
            has_buy_order=True,
            buy_order_id="buy_123",
        )

        assert level.has_buy_order is True
        assert level.buy_order_id == "buy_123"
        assert level.has_sell_order is False


class TestRiskManager:
    """Tests for RiskManager."""

    def test_risk_manager_initialization(self):
        """Test risk manager initializes with default limits."""
        rm = RiskManager()

        assert rm.limits.max_position_size > 0
        assert rm.limits.daily_loss_limit > 0
        assert rm.limits.max_open_orders > 0

    def test_risk_manager_custom_limits(self):
        """Test risk manager with custom limits."""
        limits = RiskLimits(
            max_position_size=0.5,
            daily_loss_limit=500,
            max_open_orders=100,
        )
        rm = RiskManager(limits=limits)

        assert rm.limits.max_position_size == 0.5
        assert rm.limits.daily_loss_limit == 500
        assert rm.limits.max_open_orders == 100

    def test_can_place_order_within_limits(self):
        """Test that orders within limits are allowed."""
        rm = RiskManager()
        rm.update_balance(10000)

        allowed, reason = rm.can_place_order(
            side=OrderSide.BUY,
            quantity=0.001,
            price=42000,
            current_open_orders=5,
        )

        assert allowed is True
        assert reason == "OK"

    def test_cannot_place_order_exceeds_max_orders(self):
        """Test that orders exceeding max open orders are rejected."""
        limits = RiskLimits(max_open_orders=10)
        rm = RiskManager(limits=limits)
        rm.update_balance(10000)

        allowed, reason = rm.can_place_order(
            side=OrderSide.BUY,
            quantity=0.001,
            price=42000,
            current_open_orders=10,
        )

        assert allowed is False
        assert "Max open orders" in reason

    def test_daily_loss_limit_blocks_trading(self):
        """Test that reaching daily loss limit blocks trading."""
        limits = RiskLimits(daily_loss_limit=100)
        rm = RiskManager(limits=limits)
        rm.update_balance(10000)

        # Record losses
        rm.record_trade_pnl(-50)
        rm.record_trade_pnl(-50)

        allowed, reason = rm.can_place_order(
            side=OrderSide.BUY,
            quantity=0.001,
            price=42000,
            current_open_orders=5,
        )

        assert allowed is False
        assert "Daily loss limit" in reason

    def test_update_balance_tracks_drawdown(self):
        """Test that balance updates track drawdown."""
        rm = RiskManager()

        rm.update_balance(10000)
        assert rm.metrics.drawdown == 0

        rm.update_balance(9000)
        assert rm.metrics.drawdown == 10.0  # 10% drawdown

    def test_stop_loss_check(self):
        """Test stop loss trigger check."""
        limits = RiskLimits(stop_loss_percent=5)
        rm = RiskManager(limits=limits)

        config = GridConfig(
            trading_pair="BTCUSDT",
            upper_price=45000,
            lower_price=40000,
            grid_count=10,
            amount_per_grid=0.001,
        )

        # Price within range
        assert rm.check_stop_loss(39000, config) is False

        # Price below stop loss (40000 * 0.95 = 38000)
        assert rm.check_stop_loss(37500, config) is True

    def test_risk_report(self):
        """Test risk report generation."""
        rm = RiskManager()
        rm.update_balance(10000)
        rm.record_trade_pnl(50)
        rm.record_trade_pnl(-20)

        report = rm.get_risk_report()

        assert "daily_pnl" in report
        assert "risk_status" in report
        assert report["daily_pnl"] == 30  # 50 - 20

    def test_reset_daily_metrics(self):
        """Test daily metrics reset."""
        rm = RiskManager()
        rm.record_trade_pnl(-50)
        rm.record_trade_pnl(-30)

        assert rm.metrics.daily_pnl == -80

        rm.reset_daily_metrics()

        assert rm.metrics.daily_pnl == 0


class TestGridBot:
    """Tests for GridBot."""

    @pytest.fixture
    def mock_client(self):
        """Create a mock Binance client."""
        client = MagicMock()
        client.get_current_price = AsyncMock(return_value=42500)
        client.place_limit_order = AsyncMock()
        client.cancel_all_orders = AsyncMock(return_value=0)
        client.on_price_update = MagicMock()
        client.on_order_update = MagicMock()
        return client

    @pytest.fixture
    def grid_config(self):
        """Create a test grid config."""
        return GridConfig(
            trading_pair="BTCUSDT",
            upper_price=45000,
            lower_price=40000,
            grid_count=10,
            amount_per_grid=0.001,
        )

    def test_grid_bot_initialization(self, mock_client, grid_config):
        """Test grid bot initializes correctly."""
        bot = GridBot(mock_client, grid_config, simulation_mode=True)

        assert bot.simulation_mode is True
        assert bot.config == grid_config
        assert bot.is_running is False

    def test_grid_bot_status(self, mock_client, grid_config):
        """Test getting bot status."""
        bot = GridBot(mock_client, grid_config, simulation_mode=True)
        status = bot.get_status()

        assert status.is_running is False
        assert status.simulation_mode is True
        assert status.trading_pair == "BTCUSDT"
        assert status.total_profit == 0.0

    @pytest.mark.asyncio
    async def test_grid_bot_start_simulation(self, mock_client, grid_config):
        """Test starting bot in simulation mode."""
        bot = GridBot(mock_client, grid_config, simulation_mode=True)

        await bot.start()

        assert bot.is_running is True
        assert len(bot.grid_levels) == 11  # grid_count + 1

    @pytest.mark.asyncio
    async def test_grid_bot_stop(self, mock_client, grid_config):
        """Test stopping the bot."""
        bot = GridBot(mock_client, grid_config, simulation_mode=True)
        await bot.start()
        await bot.stop()

        assert bot.is_running is False

    @pytest.mark.asyncio
    async def test_grid_bot_cannot_start_twice(self, mock_client, grid_config):
        """Test that bot cannot be started twice."""
        bot = GridBot(mock_client, grid_config, simulation_mode=True)
        await bot.start()

        # Should not raise but should log warning
        await bot.start()

        assert bot.is_running is True

    def test_update_config_requires_stop(self, mock_client, grid_config):
        """Test that config cannot be updated while running."""
        bot = GridBot(mock_client, grid_config, simulation_mode=True)
        bot._running = True

        new_config = GridConfig(
            trading_pair="ETHUSDT",
            upper_price=3000,
            lower_price=2500,
            grid_count=5,
            amount_per_grid=0.01,
        )

        with pytest.raises(RuntimeError):
            bot.update_config(new_config)

    @pytest.mark.asyncio
    async def test_simulate_price_movement(self, mock_client, grid_config):
        """Test price simulation."""
        bot = GridBot(mock_client, grid_config, simulation_mode=True)
        await bot.start()

        await bot.simulate_price_movement(41000)

        assert bot.current_price == 41000

    @pytest.mark.asyncio
    async def test_simulate_price_requires_simulation_mode(
        self, mock_client, grid_config
    ):
        """Test that price simulation requires simulation mode."""
        bot = GridBot(mock_client, grid_config, simulation_mode=False)

        with pytest.raises(RuntimeError):
            await bot.simulate_price_movement(41000)
