"""FastAPI web interface."""

import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi.requests import Request
from pydantic import BaseModel

from src.bot.grid import GridBot
from src.bot.risk import RiskManager
from src.exchange.binance import BinanceClient
from src.models.schemas import GridConfig, BotStatus, DashboardData, Balance
from src.models.database import init_db
from src.utils.config import get_settings
from src.utils.logger import setup_logging, get_logger

logger = get_logger(__name__)

# Global state
bot: Optional[GridBot] = None
client: Optional[BinanceClient] = None
risk_manager: Optional[RiskManager] = None
websocket_connections: list[WebSocket] = []


class GridConfigRequest(BaseModel):
    """Request model for updating grid config."""
    trading_pair: str = "BTCUSDT"
    upper_price: float
    lower_price: float
    grid_count: int
    amount_per_grid: float
    grid_type: str = "arithmetic"


class BotActionRequest(BaseModel):
    """Request model for bot actions."""
    action: str  # start, stop
    simulation_mode: bool = True


class SimulatePriceRequest(BaseModel):
    """Request model for price simulation."""
    price: float


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global client, bot, risk_manager

    setup_logging()
    logger.info("application_starting")

    # Initialize database
    await init_db()

    # Initialize Binance client
    settings = get_settings()
    client = BinanceClient()

    # Only connect if we have API keys
    if settings.binance_api_key and settings.binance_api_secret:
        try:
            await client.connect()
        except Exception as e:
            logger.warning("binance_connection_skipped", error=str(e))

    # Initialize risk manager
    risk_manager = RiskManager()

    # Initialize bot in simulation mode
    bot = GridBot(client, simulation_mode=settings.simulation_mode)
    bot.on_status_update(broadcast_status)

    yield

    # Cleanup
    if bot and bot.is_running:
        await bot.stop()

    if client:
        await client.disconnect()

    logger.info("application_stopped")


app = FastAPI(
    title="Crypto Grid Trading Bot",
    description="Grid trading bot for Binance with web interface",
    version="0.1.0",
    lifespan=lifespan,
)

# Mount static files
app.mount(
    "/static",
    StaticFiles(directory="src/web/static"),
    name="static",
)

# Templates
templates = Jinja2Templates(directory="src/web/templates")


async def broadcast_status(status: BotStatus) -> None:
    """Broadcast status to all connected WebSocket clients."""
    if not websocket_connections:
        return

    data = {
        "type": "status",
        "data": status.model_dump(),
    }

    disconnected = []
    for ws in websocket_connections:
        try:
            await ws.send_json(data)
        except Exception:
            disconnected.append(ws)

    for ws in disconnected:
        websocket_connections.remove(ws)


# API Routes
@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Render the dashboard page."""
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/api/status")
async def get_status() -> BotStatus:
    """Get current bot status."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")
    return bot.get_status()


@app.get("/api/config")
async def get_config() -> GridConfig:
    """Get current grid configuration."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")
    return bot.config


@app.post("/api/config")
async def update_config(config: GridConfigRequest) -> GridConfig:
    """Update grid configuration."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")

    if bot.is_running:
        raise HTTPException(
            status_code=400,
            detail="Cannot update config while bot is running",
        )

    new_config = GridConfig(
        trading_pair=config.trading_pair,
        upper_price=config.upper_price,
        lower_price=config.lower_price,
        grid_count=config.grid_count,
        amount_per_grid=config.amount_per_grid,
        grid_type=config.grid_type,
    )

    bot.update_config(new_config)
    logger.info("config_updated", config=new_config.model_dump())

    return new_config


@app.post("/api/bot/start")
async def start_bot(request: BotActionRequest) -> BotStatus:
    """Start the trading bot."""
    global bot

    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")

    if bot.is_running:
        raise HTTPException(status_code=400, detail="Bot is already running")

    bot.simulation_mode = request.simulation_mode

    try:
        await bot.start()
        return bot.get_status()
    except Exception as e:
        logger.error("bot_start_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/bot/stop")
async def stop_bot() -> BotStatus:
    """Stop the trading bot."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")

    if not bot.is_running:
        raise HTTPException(status_code=400, detail="Bot is not running")

    await bot.stop()
    return bot.get_status()


@app.get("/api/grid-levels")
async def get_grid_levels():
    """Get current grid levels status."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")
    return bot.grid_levels


@app.get("/api/orders")
async def get_orders():
    """Get open orders."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")
    return bot.get_open_orders()


@app.get("/api/trades")
async def get_trades():
    """Get executed trades."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")
    return bot.get_trades()


@app.get("/api/balances")
async def get_balances() -> list[Balance]:
    """Get account balances."""
    if not client:
        raise HTTPException(status_code=503, detail="Client not initialized")

    settings = get_settings()
    if settings.simulation_mode:
        # Return simulated balances
        return [
            Balance(asset="USDT", free=10000.0, locked=0.0),
            Balance(asset="BTC", free=0.0, locked=0.0),
        ]

    try:
        return await client.get_balances()
    except Exception as e:
        logger.error("balance_fetch_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/price")
async def get_current_price() -> dict:
    """Get current price."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")

    return {
        "price": bot.current_price,
        "trading_pair": bot.config.trading_pair,
    }


@app.post("/api/simulate/price")
async def simulate_price(request: SimulatePriceRequest) -> dict:
    """Simulate price movement (simulation mode only)."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")

    if not bot.simulation_mode:
        raise HTTPException(
            status_code=400,
            detail="Price simulation only available in simulation mode",
        )

    if not bot.is_running:
        raise HTTPException(status_code=400, detail="Bot is not running")

    await bot.simulate_price_movement(request.price)

    return {
        "success": True,
        "new_price": request.price,
    }


@app.get("/api/risk")
async def get_risk_metrics():
    """Get risk management metrics."""
    if not risk_manager:
        raise HTTPException(status_code=503, detail="Risk manager not initialized")
    return risk_manager.get_risk_report()


@app.get("/api/dashboard")
async def get_dashboard_data() -> DashboardData:
    """Get complete dashboard data."""
    if not bot:
        raise HTTPException(status_code=503, detail="Bot not initialized")

    settings = get_settings()

    # Get balances
    if settings.simulation_mode or not client:
        balances = [
            Balance(asset="USDT", free=10000.0, locked=0.0),
            Balance(asset="BTC", free=0.0, locked=0.0),
        ]
    else:
        try:
            balances = await client.get_balances()
        except Exception:
            balances = []

    return DashboardData(
        status=bot.get_status(),
        balances=balances,
        grid_levels=bot.grid_levels,
        recent_trades=bot.get_trades()[-20:],
        open_orders=bot.get_open_orders(),
    )


# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await websocket.accept()
    websocket_connections.append(websocket)

    logger.info("websocket_connected", total=len(websocket_connections))

    try:
        # Send initial status
        if bot:
            await websocket.send_json({
                "type": "status",
                "data": bot.get_status().model_dump(),
            })

        # Keep connection alive and handle messages
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=30,
                )

                # Handle ping
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})

            except asyncio.TimeoutError:
                # Send ping to keep alive
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        pass
    finally:
        if websocket in websocket_connections:
            websocket_connections.remove(websocket)
        logger.info("websocket_disconnected", total=len(websocket_connections))
