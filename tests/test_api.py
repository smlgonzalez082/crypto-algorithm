"""Tests for the web API."""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient


# Mock the settings before importing the app
@pytest.fixture(autouse=True)
def mock_settings():
    """Mock settings for all tests."""
    with patch("src.utils.config.get_settings") as mock:
        settings = MagicMock()
        settings.binance_api_key = ""
        settings.binance_api_secret = ""
        settings.binance_testnet = True
        settings.trading_pair = "BTCUSDT"
        settings.grid_upper = 45000.0
        settings.grid_lower = 40000.0
        settings.grid_count = 10
        settings.grid_amount = 0.001
        settings.grid_type = "arithmetic"
        settings.simulation_mode = True
        settings.log_level = "INFO"
        settings.web_host = "0.0.0.0"
        settings.web_port = 8000
        settings.database_url = "sqlite+aiosqlite:///./test_trading.db"
        mock.return_value = settings
        yield mock


class TestAPIEndpoints:
    """Tests for API endpoints."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from src.web.api import app

        with TestClient(app) as client:
            yield client

    def test_dashboard_page(self, client):
        """Test that dashboard page loads."""
        response = client.get("/")
        assert response.status_code == 200
        assert "Grid Trading Bot" in response.text

    def test_get_status(self, client):
        """Test getting bot status."""
        response = client.get("/api/status")
        assert response.status_code == 200

        data = response.json()
        assert "is_running" in data
        assert "simulation_mode" in data
        assert "trading_pair" in data

    def test_get_config(self, client):
        """Test getting grid config."""
        response = client.get("/api/config")
        assert response.status_code == 200

        data = response.json()
        assert "trading_pair" in data
        assert "upper_price" in data
        assert "lower_price" in data
        assert "grid_count" in data

    def test_update_config(self, client):
        """Test updating grid config."""
        new_config = {
            "trading_pair": "BTCUSDT",
            "upper_price": 50000,
            "lower_price": 45000,
            "grid_count": 15,
            "amount_per_grid": 0.002,
            "grid_type": "arithmetic",
        }

        response = client.post("/api/config", json=new_config)
        assert response.status_code == 200

        data = response.json()
        assert data["upper_price"] == 50000
        assert data["grid_count"] == 15

    def test_update_config_while_running_fails(self, client):
        """Test that config update fails while bot is running."""
        # Start the bot first
        response = client.post(
            "/api/bot/start", json={"action": "start", "simulation_mode": True}
        )
        assert response.status_code == 200

        # Try to update config
        new_config = {
            "trading_pair": "BTCUSDT",
            "upper_price": 50000,
            "lower_price": 45000,
            "grid_count": 15,
            "amount_per_grid": 0.002,
            "grid_type": "arithmetic",
        }

        response = client.post("/api/config", json=new_config)
        assert response.status_code == 400

        # Stop the bot
        client.post("/api/bot/stop")

    def test_start_bot(self, client):
        """Test starting the bot."""
        response = client.post(
            "/api/bot/start", json={"action": "start", "simulation_mode": True}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["is_running"] is True
        assert data["simulation_mode"] is True

        # Cleanup
        client.post("/api/bot/stop")

    def test_stop_bot(self, client):
        """Test stopping the bot."""
        # Start first
        client.post("/api/bot/start", json={"action": "start", "simulation_mode": True})

        # Then stop
        response = client.post("/api/bot/stop")
        assert response.status_code == 200

        data = response.json()
        assert data["is_running"] is False

    def test_stop_bot_when_not_running(self, client):
        """Test that stopping bot when not running returns error."""
        response = client.post("/api/bot/stop")
        assert response.status_code == 400

    def test_start_bot_twice_fails(self, client):
        """Test that starting bot twice returns error."""
        # Start first time
        response = client.post(
            "/api/bot/start", json={"action": "start", "simulation_mode": True}
        )
        assert response.status_code == 200

        # Start second time should fail
        response = client.post(
            "/api/bot/start", json={"action": "start", "simulation_mode": True}
        )
        assert response.status_code == 400

        # Cleanup
        client.post("/api/bot/stop")

    def test_get_grid_levels(self, client):
        """Test getting grid levels."""
        # Start bot first to initialize grid levels
        client.post("/api/bot/start", json={"action": "start", "simulation_mode": True})

        response = client.get("/api/grid-levels")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0

        # Cleanup
        client.post("/api/bot/stop")

    def test_get_orders(self, client):
        """Test getting open orders."""
        response = client.get("/api/orders")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_get_trades(self, client):
        """Test getting trades."""
        response = client.get("/api/trades")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_get_balances(self, client):
        """Test getting balances."""
        response = client.get("/api/balances")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, list)
        # In simulation mode, should return default balances
        assert len(data) >= 1

    def test_get_current_price(self, client):
        """Test getting current price."""
        response = client.get("/api/price")
        assert response.status_code == 200

        data = response.json()
        assert "price" in data
        assert "trading_pair" in data

    def test_simulate_price(self, client):
        """Test simulating price movement."""
        # Start bot in simulation mode
        client.post("/api/bot/start", json={"action": "start", "simulation_mode": True})

        response = client.post("/api/simulate/price", json={"price": 43000})
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is True
        assert data["new_price"] == 43000

        # Cleanup
        client.post("/api/bot/stop")

    def test_simulate_price_not_running(self, client):
        """Test that price simulation fails when bot not running."""
        response = client.post("/api/simulate/price", json={"price": 43000})
        assert response.status_code == 400

    def test_get_dashboard_data(self, client):
        """Test getting complete dashboard data."""
        response = client.get("/api/dashboard")
        assert response.status_code == 200

        data = response.json()
        assert "status" in data
        assert "balances" in data
        assert "grid_levels" in data
        assert "recent_trades" in data
        assert "open_orders" in data

    def test_get_risk_metrics(self, client):
        """Test getting risk metrics."""
        response = client.get("/api/risk")
        assert response.status_code == 200

        data = response.json()
        assert "daily_pnl" in data
        assert "risk_status" in data


class TestWebSocket:
    """Tests for WebSocket functionality."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from src.web.api import app

        with TestClient(app) as client:
            yield client

    def test_websocket_connection(self, client):
        """Test WebSocket connection."""
        with client.websocket_connect("/ws") as websocket:
            # Should receive initial status
            data = websocket.receive_json()
            assert data["type"] == "status"
            assert "data" in data

    def test_websocket_ping_pong(self, client):
        """Test WebSocket ping/pong."""
        with client.websocket_connect("/ws") as websocket:
            # Consume initial status
            websocket.receive_json()

            # Send ping
            websocket.send_json({"type": "ping"})

            # Should receive pong
            data = websocket.receive_json()
            assert data["type"] == "pong"
