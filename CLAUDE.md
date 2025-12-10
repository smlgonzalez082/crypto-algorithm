# Crypto Grid Trading Bot

## Project Overview
A grid trading bot for cryptocurrency trading on Binance, designed to run on AWS.

## Architecture
- **Language**: Python 3.11+
- **Exchange**: Binance (via python-binance SDK)
- **Deployment**: AWS (EC2 or Lambda + EventBridge for scheduling)
- **Database**: SQLite for local dev, PostgreSQL/DynamoDB for production

## Project Structure
```
cryptotrading/
├── src/
│   ├── bot/
│   │   ├── __init__.py
│   │   ├── grid.py          # Grid trading logic
│   │   ├── orders.py        # Order management
│   │   └── risk.py          # Risk management
│   ├── exchange/
│   │   ├── __init__.py
│   │   └── binance.py       # Binance API wrapper
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py       # Data models
│   └── utils/
│       ├── __init__.py
│       ├── config.py        # Configuration management
│       └── logger.py        # Logging setup
├── tests/
│   └── ...
├── scripts/
│   └── ...
├── infrastructure/
│   └── terraform/           # AWS infrastructure as code
├── .env.example
├── requirements.txt
├── pyproject.toml
└── README.md
```

## Grid Trading Strategy
1. Define price range (upper_bound, lower_bound)
2. Create N grid levels with equal or geometric spacing
3. Place buy orders below current price at grid levels
4. Place sell orders above current price at grid levels
5. When buy fills → place sell one level up
6. When sell fills → place buy one level down
7. Profit = spread between levels minus fees

## Configuration
Key parameters (set via environment variables):
- `BINANCE_API_KEY` - Binance API key
- `BINANCE_API_SECRET` - Binance API secret
- `TRADING_PAIR` - e.g., BTCUSDT
- `GRID_UPPER` - Upper price bound
- `GRID_LOWER` - Lower price bound
- `GRID_COUNT` - Number of grid levels
- `GRID_AMOUNT` - Amount per grid order
- `SIMULATION_MODE` - true/false for paper trading

## Development Commands
```bash
# Install dependencies
pip install -r requirements.txt

# Run in simulation mode
python -m src.bot.grid --simulate

# Run tests
pytest tests/

# Run linter
ruff check src/

# Format code
ruff format src/
```

## AWS Deployment
- EC2 t3.micro or t3.small is sufficient
- Use AWS Secrets Manager for API keys
- CloudWatch for logging and alerts
- Consider using AWS region ap-northeast-1 (Tokyo) for lower latency to Binance

## Risk Management
- Maximum position size limit
- Stop loss if price breaks below grid by X%
- Daily loss limit
- Automatic shutdown on consecutive errors

## Important Notes
- NEVER commit API keys or secrets
- Always test with simulation mode first
- Start with small amounts when going live
- Monitor the bot regularly, especially initially
