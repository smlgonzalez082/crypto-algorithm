"""Tests for grid trading logic."""

import pytest
from src.models.schemas import GridConfig, OrderSide


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

    def test_validation(self):
        """Test config validation."""
        # Valid config should work
        config = GridConfig(
            trading_pair="BTCUSDT",
            upper_price=45000,
            lower_price=40000,
            grid_count=10,
            amount_per_grid=0.001,
        )
        assert config.grid_count == 10

        # Invalid grid count should raise
        with pytest.raises(ValueError):
            GridConfig(
                trading_pair="BTCUSDT",
                upper_price=45000,
                lower_price=40000,
                grid_count=1,  # Must be >= 2
                amount_per_grid=0.001,
            )


class TestOrderSide:
    """Tests for OrderSide enum."""

    def test_order_sides(self):
        """Test order side values."""
        assert OrderSide.BUY.value == "BUY"
        assert OrderSide.SELL.value == "SELL"
