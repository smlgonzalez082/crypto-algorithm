# Crypto Grid Trading Bot

A grid trading bot for Binance with a web-based dashboard for monitoring and control.

## Features

- **Grid Trading Strategy**: Automated buy/sell orders across a price range
- **Web Dashboard**: Real-time monitoring of trades, orders, and P&L
- **Simulation Mode**: Paper trading to test strategies without risking funds
- **Risk Management**: Stop loss, daily loss limits, and position sizing
- **AWS Ready**: Terraform infrastructure for production deployment

## Quick Start

### Prerequisites

- Python 3.11+
- Docker (optional, for deployment)
- Binance account with API access

### Local Development

1. **Clone and setup**:
   ```bash
   cd cryptotrading
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Run the bot**:
   ```bash
   python -m src.main
   ```

4. **Open the dashboard**:
   Visit http://localhost:8000

### Using Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `BINANCE_API_KEY` | Your Binance API key | - |
| `BINANCE_API_SECRET` | Your Binance API secret | - |
| `BINANCE_TESTNET` | Use Binance testnet | `true` |
| `TRADING_PAIR` | Trading pair symbol | `BTCUSDT` |
| `GRID_UPPER` | Upper price bound | `45000` |
| `GRID_LOWER` | Lower price bound | `40000` |
| `GRID_COUNT` | Number of grid levels | `10` |
| `GRID_AMOUNT` | Amount per grid order | `0.001` |
| `SIMULATION_MODE` | Enable paper trading | `true` |

## Grid Trading Strategy

The bot implements a classic grid trading strategy:

1. Define a price range with upper and lower bounds
2. Divide the range into N grid levels
3. Place buy orders below current price
4. Place sell orders above current price
5. When a buy fills → place sell one level up
6. When a sell fills → place buy one level down
7. Profit from the spread between levels

### Grid Types

- **Arithmetic**: Equal price spacing between levels
- **Geometric**: Equal percentage spacing (better for volatile markets)

## AWS Deployment

### Prerequisites

- AWS CLI configured
- Terraform installed
- SSH key pair in AWS

### Deploy

1. **Setup Terraform**:
   ```bash
   cd infrastructure/terraform
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your values
   ```

2. **Deploy infrastructure**:
   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

3. **Configure the server**:
   ```bash
   # SSH into the instance (command shown in terraform output)
   ssh -i ~/.ssh/your-key.pem ec2-user@<IP>

   # Run setup script
   ./scripts/setup_ec2.sh

   # Copy files and configure .env
   # Then deploy
   ./scripts/deploy.sh
   ```

4. **Set API secrets** (via AWS Secrets Manager):
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id trading-bot/binance-api \
     --secret-string '{"api_key":"YOUR_KEY","api_secret":"YOUR_SECRET"}'
   ```

## Project Structure

```
cryptotrading/
├── src/
│   ├── bot/
│   │   ├── grid.py          # Grid trading logic
│   │   └── risk.py          # Risk management
│   ├── exchange/
│   │   └── binance.py       # Binance API client
│   ├── models/
│   │   ├── schemas.py       # Data models
│   │   └── database.py      # Database setup
│   ├── utils/
│   │   ├── config.py        # Configuration
│   │   └── logger.py        # Logging
│   ├── web/
│   │   ├── api.py           # FastAPI routes
│   │   ├── templates/       # HTML templates
│   │   └── static/          # CSS/JS assets
│   └── main.py              # Entry point
├── tests/
├── infrastructure/
│   └── terraform/           # AWS infrastructure
├── scripts/                 # Deployment scripts
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web dashboard |
| `/api/status` | GET | Bot status |
| `/api/config` | GET/POST | Grid configuration |
| `/api/bot/start` | POST | Start the bot |
| `/api/bot/stop` | POST | Stop the bot |
| `/api/grid-levels` | GET | Current grid levels |
| `/api/orders` | GET | Open orders |
| `/api/trades` | GET | Trade history |
| `/api/balances` | GET | Account balances |
| `/api/simulate/price` | POST | Simulate price (sim mode) |
| `/ws` | WebSocket | Real-time updates |

## Risk Management

The bot includes several risk controls:

- **Stop Loss**: Automatically stops if price drops X% below grid
- **Daily Loss Limit**: Stops trading after reaching daily loss threshold
- **Max Open Orders**: Limits total number of open orders
- **Position Sizing**: Limits exposure per trade
- **Max Drawdown**: Stops if portfolio drawdown exceeds threshold

## Testing

```bash
# Run tests
pytest tests/

# With coverage
pytest tests/ --cov=src
```

## Disclaimer

**USE AT YOUR OWN RISK**

This software is for educational purposes. Cryptocurrency trading carries significant risk. You could lose some or all of your investment. Always:

- Start with simulation mode
- Test thoroughly with small amounts
- Never invest more than you can afford to lose
- Understand the strategy before deploying

## License

MIT
