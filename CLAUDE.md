# Crypto Grid Trading Bot

## Project Overview
A multi-pair grid trading bot for cryptocurrency trading on Binance.US, with a real-time web dashboard. Supports portfolio-level risk management with correlation-aware allocation.

## Architecture
- **Language**: TypeScript (Node.js 18+)
- **Exchange**: Binance.US (via binance npm package)
- **Backend**: Express.js with WebSocket for real-time updates
- **Frontend**: Vanilla HTML/CSS/JS with Chart.js
- **Database**: SQLite (better-sqlite3) for trade persistence
- **Deployment**: AWS (EC2 with Docker)
- **CI/CD**: GitHub Actions

## Project Structure
```
cryptotrading/
├── src/
│   ├── analysis/
│   │   └── correlation.ts     # Correlation analysis for diversification
│   ├── bot/
│   │   ├── grid.ts            # Single-pair grid trading logic
│   │   ├── portfolioBot.ts    # Multi-pair portfolio manager
│   │   ├── portfolioRisk.ts   # Advanced portfolio risk management
│   │   └── risk.ts            # Single-pair risk management
│   ├── exchange/
│   │   └── binance.ts         # Binance API wrapper
│   ├── models/
│   │   └── database.ts        # SQLite database for persistence
│   ├── types/
│   │   ├── index.ts           # Core TypeScript interfaces
│   │   └── portfolio.ts       # Portfolio-specific types
│   ├── utils/
│   │   ├── config.ts          # Configuration with recommended pairs
│   │   └── logger.ts          # Pino logger setup
│   ├── web/
│   │   ├── server.ts          # Express + WebSocket server
│   │   └── static/
│   │       └── index.html     # Dashboard UI (portfolio view)
│   └── index.ts               # Application entry point
├── data/                      # SQLite database storage
├── tests/
│   ├── risk.test.ts
│   └── config.test.ts
├── .github/workflows/         # CI/CD pipelines
├── .env.example
├── package.json
├── tsconfig.json
├── Dockerfile
└── docker-compose.yml
```

## Trading Modes

### Portfolio Mode (Recommended)
Trade multiple crypto pairs simultaneously with:
- **Correlation-aware allocation**: Lower allocation to highly correlated pairs
- **Volatility-weighted sizing**: Smaller positions in high-volatility assets
- **Kelly-inspired position sizing**: Optimal bet sizing based on risk/reward
- **Circuit breakers**: Auto-pause on consecutive losses, daily loss limits, drawdown
- **Automatic rebalancing**: Maintains target allocations

### Single Pair Mode (Legacy)
Traditional grid trading on a single pair.

## Grid Trading Strategy
1. Define price range (upperPrice, lowerPrice)
2. Create N grid levels with arithmetic or geometric spacing
3. Place buy orders below current price at grid levels
4. When buy fills → place sell one level up
5. When sell fills → place buy one level down
6. Profit = spread between levels minus fees

## Recommended Pairs for Binance.US
Default portfolio pairs selected for low correlation:
- **DOGE/USDT**: High volatility, meme-driven (uncorrelated with fundamentals)
- **XLM/USDT**: Payment-focused, more stable

Alternative pairs:
- **ADA/USDT**: Smart contract platform
- **XRP/USDT**: Cross-border payments

## Risk Management Strategies

### Conservative
- 60% max total exposure, 40% cash reserve
- 2.5% max daily loss
- 10% max drawdown before pause
- Pause after 3 consecutive losses

### Moderate (Default)
- 75% max total exposure, 25% cash reserve
- 5% max daily loss
- 15% max drawdown before pause
- Pause after 5 consecutive losses

### Aggressive
- 90% max total exposure, 10% cash reserve
- 10% max daily loss
- 25% max drawdown before pause
- Pause after 7 consecutive losses

## Configuration
Key environment variables:
```bash
# Exchange
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
BINANCE_US=true

# Portfolio Mode
PORTFOLIO_MODE=true
TOTAL_CAPITAL=2000
RISK_STRATEGY=moderate  # conservative, moderate, aggressive

# Single Pair Mode (when PORTFOLIO_MODE=false)
TRADING_PAIR=DOGEUSDT
GRID_UPPER=0.45
GRID_LOWER=0.25
GRID_COUNT=15
GRID_AMOUNT=50
```

## Development Commands
```bash
npm install          # Install dependencies
npm run dev          # Development mode (hot reload)
npm run build        # Build for production
npm start            # Run production build
npm test             # Run tests
npm run typecheck    # Type check
npm run lint         # Lint code
```

## API Endpoints

### Status & Configuration
- `GET /api/health` - Health check
- `GET /api/status` - Bot status (portfolio or single)
- `GET /api/config` - Current configuration
- `GET /api/portfolio` - Full portfolio state
- `GET /api/correlation` - Correlation matrix

### Trading Data
- `GET /api/grid` - Grid levels (per pair in portfolio mode)
- `GET /api/orders` - Active orders
- `GET /api/balances` - Account balances
- `GET /api/trades` - Recent trades from Binance
- `GET /api/trades/history` - Trade history from database
- `GET /api/trades/stats` - Trade statistics

### Controls
- `POST /api/start` - Start single pair bot
- `POST /api/portfolio/start` - Start portfolio bot
- `POST /api/stop` - Stop bot
- `POST /api/portfolio/pair` - Add pair to portfolio
- `DELETE /api/portfolio/pair/:symbol` - Remove pair
- `PUT /api/portfolio/strategy` - Change risk strategy

### Risk Monitoring
- `GET /api/risk/events` - Risk event history

## WebSocket Events
Connect to `ws://localhost:3001`:
- `portfolio` - Portfolio status updates
- `pair` - Individual pair updates
- `status` - Single pair mode status
- `grid` - Grid level updates
- `orders` - Order updates

## Database Persistence
SQLite database stores:
- **trades**: All executed trades with PnL
- **grid_states**: Current grid level states
- **pair_states**: Per-pair metrics
- **portfolio_snapshots**: Historical portfolio values
- **price_history**: Price data for correlation analysis
- **risk_events**: Circuit breaker triggers

Data persists across restarts. Grid state is restored automatically.

## Important Notes
- NEVER commit API keys or secrets
- For Binance.US users: BINANCE_TESTNET doesn't work, use SIMULATION_MODE
- Start with SIMULATION_MODE=true
- The bot requires USDT balance to place grid orders
- Recommended minimum: $500 per pair for meaningful grid spacing
- Monitor the bot regularly, especially initially
- Check correlation before adding new pairs to maintain diversification
