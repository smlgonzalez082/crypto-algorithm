"""Configuration management using pydantic-settings."""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Binance API
    binance_api_key: str = ""
    binance_api_secret: str = ""
    binance_testnet: bool = True

    # Trading configuration
    trading_pair: str = "BTCUSDT"
    grid_upper: float = 45000.0
    grid_lower: float = 40000.0
    grid_count: int = 10
    grid_amount: float = 0.001
    grid_type: str = "arithmetic"  # arithmetic or geometric

    # Mode
    simulation_mode: bool = True

    # Risk management
    max_position_size: float = 0.1
    stop_loss_percent: float = 5.0
    daily_loss_limit: float = 100.0
    max_open_orders: int = 50

    # Logging
    log_level: str = "INFO"

    # Web interface
    web_host: str = "0.0.0.0"
    web_port: int = 8000

    # Database
    database_url: str = "sqlite+aiosqlite:///./trading.db"

    @property
    def grid_spacing(self) -> float:
        """Calculate the spacing between grid levels."""
        if self.grid_type == "geometric":
            return (self.grid_upper / self.grid_lower) ** (1 / self.grid_count)
        return (self.grid_upper - self.grid_lower) / self.grid_count

    def get_grid_levels(self) -> list[float]:
        """Generate all grid price levels."""
        levels = []
        if self.grid_type == "geometric":
            ratio = self.grid_spacing
            for i in range(self.grid_count + 1):
                levels.append(self.grid_lower * (ratio**i))
        else:
            spacing = self.grid_spacing
            for i in range(self.grid_count + 1):
                levels.append(self.grid_lower + (spacing * i))
        return levels


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
