"""Main entry point for the trading bot."""

import asyncio
import uvicorn

from src.utils.config import get_settings
from src.utils.logger import setup_logging


def main():
    """Run the trading bot web application."""
    setup_logging()
    settings = get_settings()

    uvicorn.run(
        "src.web.api:app",
        host=settings.web_host,
        port=settings.web_port,
        reload=settings.log_level == "DEBUG",
    )


if __name__ == "__main__":
    main()
