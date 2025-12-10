"""Binance API client wrapper."""

import asyncio
from decimal import Decimal, ROUND_DOWN
from typing import Optional, Callable
import time

from binance import AsyncClient, BinanceSocketManager
from binance.exceptions import BinanceAPIException

from src.models.schemas import Order, OrderSide, OrderStatus, Trade, Balance
from src.utils.config import get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class BinanceClient:
    """Async Binance API client wrapper."""

    def __init__(self):
        self.settings = get_settings()
        self.client: Optional[AsyncClient] = None
        self.socket_manager: Optional[BinanceSocketManager] = None
        self._symbol_info: dict = {}
        self._price_callbacks: list[Callable] = []
        self._order_callbacks: list[Callable] = []
        self._running = False

    async def connect(self) -> None:
        """Initialize connection to Binance."""
        try:
            self.client = await AsyncClient.create(
                api_key=self.settings.binance_api_key,
                api_secret=self.settings.binance_api_secret,
                testnet=self.settings.binance_testnet,
            )
            self.socket_manager = BinanceSocketManager(self.client)

            # Load symbol info for the trading pair
            await self._load_symbol_info()

            logger.info(
                "binance_connected",
                testnet=self.settings.binance_testnet,
                trading_pair=self.settings.trading_pair,
            )
        except Exception as e:
            logger.error("binance_connection_failed", error=str(e))
            raise

    async def disconnect(self) -> None:
        """Close connection to Binance."""
        self._running = False
        if self.client:
            await self.client.close_connection()
            logger.info("binance_disconnected")

    async def _load_symbol_info(self) -> None:
        """Load trading pair information for precision."""
        if not self.client:
            return

        info = await self.client.get_symbol_info(self.settings.trading_pair)
        if info:
            self._symbol_info = {
                "symbol": info["symbol"],
                "base_asset": info["baseAsset"],
                "quote_asset": info["quoteAsset"],
                "price_precision": info["quotePrecision"],
                "quantity_precision": info["baseAssetPrecision"],
            }

            # Extract filters
            for f in info["filters"]:
                if f["filterType"] == "PRICE_FILTER":
                    self._symbol_info["tick_size"] = float(f["tickSize"])
                    self._symbol_info["min_price"] = float(f["minPrice"])
                    self._symbol_info["max_price"] = float(f["maxPrice"])
                elif f["filterType"] == "LOT_SIZE":
                    self._symbol_info["step_size"] = float(f["stepSize"])
                    self._symbol_info["min_qty"] = float(f["minQty"])
                    self._symbol_info["max_qty"] = float(f["maxQty"])
                elif f["filterType"] == "NOTIONAL":
                    self._symbol_info["min_notional"] = float(f.get("minNotional", 0))

            logger.debug("symbol_info_loaded", info=self._symbol_info)

    def round_price(self, price: float) -> float:
        """Round price to valid tick size."""
        if "tick_size" not in self._symbol_info:
            return price

        tick_size = Decimal(str(self._symbol_info["tick_size"]))
        price_decimal = Decimal(str(price))
        return float(price_decimal.quantize(tick_size, rounding=ROUND_DOWN))

    def round_quantity(self, quantity: float) -> float:
        """Round quantity to valid step size."""
        if "step_size" not in self._symbol_info:
            return quantity

        step_size = Decimal(str(self._symbol_info["step_size"]))
        qty_decimal = Decimal(str(quantity))
        return float(qty_decimal.quantize(step_size, rounding=ROUND_DOWN))

    async def get_current_price(self) -> float:
        """Get current price for trading pair."""
        if not self.client:
            raise RuntimeError("Client not connected")

        ticker = await self.client.get_symbol_ticker(symbol=self.settings.trading_pair)
        return float(ticker["price"])

    async def get_balances(self) -> list[Balance]:
        """Get account balances."""
        if not self.client:
            raise RuntimeError("Client not connected")

        account = await self.client.get_account()
        balances = []

        for b in account["balances"]:
            free = float(b["free"])
            locked = float(b["locked"])
            if free > 0 or locked > 0:
                balances.append(Balance(
                    asset=b["asset"],
                    free=free,
                    locked=locked,
                ))

        return balances

    async def get_balance(self, asset: str) -> Balance:
        """Get balance for specific asset."""
        if not self.client:
            raise RuntimeError("Client not connected")

        account = await self.client.get_account()

        for b in account["balances"]:
            if b["asset"] == asset:
                return Balance(
                    asset=b["asset"],
                    free=float(b["free"]),
                    locked=float(b["locked"]),
                )

        return Balance(asset=asset, free=0.0, locked=0.0)

    async def place_limit_order(
        self,
        side: OrderSide,
        price: float,
        quantity: float,
        grid_level: Optional[int] = None,
    ) -> Order:
        """Place a limit order."""
        if not self.client:
            raise RuntimeError("Client not connected")

        # Round to valid precision
        price = self.round_price(price)
        quantity = self.round_quantity(quantity)

        # Validate minimum notional
        notional = price * quantity
        min_notional = self._symbol_info.get("min_notional", 0)
        if notional < min_notional:
            raise ValueError(f"Order notional {notional} below minimum {min_notional}")

        try:
            client_order_id = f"grid_{grid_level}_{side.value}_{int(time.time() * 1000)}"

            result = await self.client.create_order(
                symbol=self.settings.trading_pair,
                side=side.value,
                type="LIMIT",
                timeInForce="GTC",
                price=str(price),
                quantity=str(quantity),
                newClientOrderId=client_order_id,
            )

            order = Order(
                order_id=str(result["orderId"]),
                client_order_id=result["clientOrderId"],
                trading_pair=result["symbol"],
                side=OrderSide(result["side"]),
                order_type=result["type"],
                price=float(result["price"]),
                quantity=float(result["origQty"]),
                filled_quantity=float(result["executedQty"]),
                status=OrderStatus(result["status"]),
                grid_level=grid_level,
            )

            logger.info(
                "order_placed",
                order_id=order.order_id,
                side=side.value,
                price=price,
                quantity=quantity,
                grid_level=grid_level,
            )

            return order

        except BinanceAPIException as e:
            logger.error(
                "order_failed",
                error=str(e),
                side=side.value,
                price=price,
                quantity=quantity,
            )
            raise

    async def cancel_order(self, order_id: str) -> bool:
        """Cancel an order."""
        if not self.client:
            raise RuntimeError("Client not connected")

        try:
            await self.client.cancel_order(
                symbol=self.settings.trading_pair,
                orderId=int(order_id),
            )
            logger.info("order_cancelled", order_id=order_id)
            return True
        except BinanceAPIException as e:
            logger.error("cancel_failed", order_id=order_id, error=str(e))
            return False

    async def cancel_all_orders(self) -> int:
        """Cancel all open orders for the trading pair."""
        if not self.client:
            raise RuntimeError("Client not connected")

        try:
            result = await self.client.cancel_open_orders(
                symbol=self.settings.trading_pair
            )
            count = len(result) if isinstance(result, list) else 0
            logger.info("all_orders_cancelled", count=count)
            return count
        except BinanceAPIException as e:
            logger.error("cancel_all_failed", error=str(e))
            return 0

    async def get_open_orders(self) -> list[Order]:
        """Get all open orders."""
        if not self.client:
            raise RuntimeError("Client not connected")

        orders = await self.client.get_open_orders(symbol=self.settings.trading_pair)

        return [
            Order(
                order_id=str(o["orderId"]),
                client_order_id=o["clientOrderId"],
                trading_pair=o["symbol"],
                side=OrderSide(o["side"]),
                order_type=o["type"],
                price=float(o["price"]),
                quantity=float(o["origQty"]),
                filled_quantity=float(o["executedQty"]),
                status=OrderStatus(o["status"]),
                grid_level=self._extract_grid_level(o["clientOrderId"]),
            )
            for o in orders
        ]

    async def get_order(self, order_id: str) -> Optional[Order]:
        """Get a specific order by ID."""
        if not self.client:
            raise RuntimeError("Client not connected")

        try:
            o = await self.client.get_order(
                symbol=self.settings.trading_pair,
                orderId=int(order_id),
            )

            return Order(
                order_id=str(o["orderId"]),
                client_order_id=o["clientOrderId"],
                trading_pair=o["symbol"],
                side=OrderSide(o["side"]),
                order_type=o["type"],
                price=float(o["price"]),
                quantity=float(o["origQty"]),
                filled_quantity=float(o["executedQty"]),
                status=OrderStatus(o["status"]),
                grid_level=self._extract_grid_level(o["clientOrderId"]),
            )
        except BinanceAPIException:
            return None

    async def get_recent_trades(self, limit: int = 50) -> list[Trade]:
        """Get recent trades for the account."""
        if not self.client:
            raise RuntimeError("Client not connected")

        trades = await self.client.get_my_trades(
            symbol=self.settings.trading_pair,
            limit=limit,
        )

        return [
            Trade(
                trade_id=str(t["id"]),
                order_id=str(t["orderId"]),
                trading_pair=t["symbol"],
                side=OrderSide.BUY if t["isBuyer"] else OrderSide.SELL,
                price=float(t["price"]),
                quantity=float(t["qty"]),
                commission=float(t["commission"]),
                commission_asset=t["commissionAsset"],
            )
            for t in trades
        ]

    def _extract_grid_level(self, client_order_id: str) -> Optional[int]:
        """Extract grid level from client order ID."""
        if client_order_id and client_order_id.startswith("grid_"):
            parts = client_order_id.split("_")
            if len(parts) >= 2:
                try:
                    return int(parts[1])
                except ValueError:
                    pass
        return None

    def on_price_update(self, callback: Callable) -> None:
        """Register callback for price updates."""
        self._price_callbacks.append(callback)

    def on_order_update(self, callback: Callable) -> None:
        """Register callback for order updates."""
        self._order_callbacks.append(callback)

    async def start_price_stream(self) -> None:
        """Start WebSocket stream for price updates."""
        if not self.socket_manager:
            raise RuntimeError("Socket manager not initialized")

        self._running = True

        async with self.socket_manager.symbol_ticker_socket(
            self.settings.trading_pair
        ) as stream:
            while self._running:
                try:
                    msg = await asyncio.wait_for(stream.recv(), timeout=30)
                    if msg and "c" in msg:
                        price = float(msg["c"])
                        for callback in self._price_callbacks:
                            await callback(price)
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    logger.error("price_stream_error", error=str(e))
                    if self._running:
                        await asyncio.sleep(5)

    async def start_user_stream(self) -> None:
        """Start WebSocket stream for user updates (orders, trades)."""
        if not self.client or not self.socket_manager:
            raise RuntimeError("Client not initialized")

        self._running = True

        async with self.socket_manager.user_socket() as stream:
            while self._running:
                try:
                    msg = await asyncio.wait_for(stream.recv(), timeout=60)
                    if msg:
                        await self._handle_user_message(msg)
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    logger.error("user_stream_error", error=str(e))
                    if self._running:
                        await asyncio.sleep(5)

    async def _handle_user_message(self, msg: dict) -> None:
        """Handle user stream messages."""
        event_type = msg.get("e")

        if event_type == "executionReport":
            order = Order(
                order_id=str(msg["i"]),
                client_order_id=msg["c"],
                trading_pair=msg["s"],
                side=OrderSide(msg["S"]),
                order_type=msg["o"],
                price=float(msg["p"]),
                quantity=float(msg["q"]),
                filled_quantity=float(msg["z"]),
                status=OrderStatus(msg["X"]),
                grid_level=self._extract_grid_level(msg["c"]),
            )

            for callback in self._order_callbacks:
                await callback(order)

            logger.debug(
                "order_update",
                order_id=order.order_id,
                status=order.status.value,
                filled=order.filled_quantity,
            )
