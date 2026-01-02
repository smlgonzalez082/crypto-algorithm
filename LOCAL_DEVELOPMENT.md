# Local Development Guide

## Quick Start

### Option 1: Use the Startup Script (Recommended)

```bash
./start-local.sh
```

This script will:
- ✅ Check Node.js version (requires 22.x+)
- ✅ Create `.env` from `.env.example` if needed
- ✅ Install dependencies automatically
- ✅ Display configuration summary
- ✅ Start the development server with hot reload

### Option 2: Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env

# 3. Edit .env with your configuration
# (Optional: Add Binance API keys, or keep SIMULATION_MODE=true)

# 4. Start development server
npm run dev
```

## Available Commands

### Development
```bash
npm run dev              # Start dev server with hot reload (recommended)
npm run build            # Build TypeScript to JavaScript
npm start                # Run production build
```

### Testing
```bash
npm test                 # Run unit + integration tests
npm run test:unit        # Run unit tests only
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npm run test:e2e         # Run end-to-end tests
npm run test:e2e:ui      # Run E2E tests with UI
```

### Code Quality
```bash
npm run lint             # Check code style
npm run lint:fix         # Fix code style issues
npm run format           # Format code with Prettier
npm run typecheck        # TypeScript type checking
```

## Access Points

Once the server is running:

- **Dashboard:** http://localhost:3002
- **Login Page:** http://localhost:3002/login.html
- **API Health:** http://localhost:3002/api/health
- **WebSocket:** ws://localhost:3002

*Note: Port is configurable in `.env` via `SERVER_PORT`*

## Environment Configuration

### Required Settings
- `SIMULATION_MODE=true` - **Keep this true for safe testing!**
- `SERVER_PORT=3002` - Port for web dashboard
- `NODE_ENV=development` - Development mode

### Optional Settings
- `BINANCE_API_KEY` - Your Binance API key (not needed for simulation)
- `BINANCE_API_SECRET` - Your Binance API secret
- `PORTFOLIO_MODE=true` - Enable multi-pair trading
- `TOTAL_CAPITAL=2000` - Total capital for portfolio mode
- `RISK_STRATEGY=moderate` - Risk level (conservative/moderate/aggressive)

### Authentication (Optional)
Leave these empty for local development without authentication:
- `COGNITO_USER_POOL_ID` - AWS Cognito User Pool ID
- `COGNITO_CLIENT_ID` - AWS Cognito Client ID
- `COGNITO_REGION` - AWS Region (e.g., us-east-1)

## Development Features

### Hot Reload
The dev server automatically restarts when you modify TypeScript files.

### Simulation Mode
- Runs without real API calls
- Simulates price movements
- Perfect for testing strategies
- Zero risk of losing money

### Portfolio Mode
Test multiple trading pairs with:
- Correlation-aware allocation
- Volatility-weighted sizing
- Circuit breakers
- Real-time risk metrics

## Project Structure

```
cryptotrading/
├── src/
│   ├── analysis/          # Correlation & analytics
│   ├── bot/               # Trading logic
│   ├── exchange/          # Binance API wrapper
│   ├── models/            # Database models
│   ├── types/             # TypeScript interfaces
│   ├── utils/             # Utilities & config
│   ├── web/               # Express server
│   │   ├── server.ts      # Main server file
│   │   └── static/        # Frontend files (HTML/CSS/JS)
│   └── index.ts           # Application entry point
├── data/                  # SQLite database
├── tests/                 # Test files
└── .env                   # Your configuration (create from .env.example)
```

## Troubleshooting

### Port Already in Use
```bash
# Change SERVER_PORT in .env to a different port
SERVER_PORT=3003
```

### Dependencies Issues
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Build Errors
```bash
# Check for type errors
npm run typecheck

# Clean build
rm -rf dist
npm run build
```

### Database Issues
```bash
# Delete and recreate database
rm -rf data/trading.db
# Restart server - database will be recreated
```

## Tips for Development

1. **Start in Simulation Mode** - Always test strategies with `SIMULATION_MODE=true` first
2. **Use Hot Reload** - `npm run dev` auto-restarts on file changes
3. **Check Logs** - Server logs appear in the terminal
4. **Run Tests** - Use `npm run test:watch` while developing
5. **Type Safety** - Run `npm run typecheck` before committing

## Next Steps

1. ✅ Start the server: `./start-local.sh`
2. ✅ Open dashboard: http://localhost:3002
3. ✅ Explore the UI and test features
4. ✅ Read the main README.md for trading strategies
5. ✅ Check CLAUDE.md for project architecture

## Need Help?

- Check the main README.md for detailed documentation
- Review CLAUDE.md for project structure
- Run tests to see examples: `npm run test:watch`
- Enable debug logging: Set `LOG_LEVEL=debug` in `.env`
