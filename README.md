# Crypto Grid Trading Bot 📈

A production-ready, multi-pair grid trading bot for Binance.US with advanced portfolio management, real-time web dashboard, and AWS deployment automation.

[![Tests](https://github.com/YOUR_USERNAME/cryptotrading/workflows/Tests/badge.svg)](https://github.com/YOUR_USERNAME/cryptotrading/actions)
[![Coverage](https://codecov.io/gh/YOUR_USERNAME/cryptotrading/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_USERNAME/cryptotrading)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

### Trading

- 🤖 **Grid Trading Strategy** - Automated buy/sell orders across price ranges
- 📊 **Multi-Pair Portfolio** - Trade multiple cryptocurrencies simultaneously
- 🎯 **Correlation-Aware Allocation** - Optimize diversification with correlation analysis
- ⚡ **Real-Time Price Feeds** - WebSocket streams for instant market data
- 💰 **Kelly-Inspired Position Sizing** - Optimal capital allocation

### Risk Management

- 🛡️ **Circuit Breakers** - Auto-pause on consecutive losses, daily limits, drawdown
- 📉 **Three Risk Strategies** - Conservative, Moderate, Aggressive profiles
- 🔔 **Risk Event Tracking** - Complete audit trail of all risk events
- 📈 **Volatility-Weighted Sizing** - Adjust positions based on market volatility
- 🎲 **Simulation Mode** - Paper trading for testing strategies

### Dashboard

- 📱 **Responsive Web UI** - Works on desktop, tablet, and mobile
- 📊 **Real-Time Updates** - WebSocket-powered live data
- 📈 **Portfolio Analytics** - Correlation matrix, volatility indicators, performance charts
- 🔄 **Live Grid Visualization** - See your grid levels and orders in real-time
- 📜 **Trade History** - Complete record of all executed trades

### Infrastructure

- ☁️ **AWS Deployment** - Production-ready Terraform infrastructure
- 🔐 **Cognito Authentication** - Secure user management with MFA support
- 🚀 **CI/CD Pipeline** - Automated testing and deployment via GitHub Actions
- 📝 **Comprehensive Logging** - CloudWatch integration for monitoring
- 🧪 **200+ Tests** - Unit, integration, and E2E test coverage

## 🚀 Quick Start

### Deploy to AWS (Recommended)

```bash
# 1. Configure GitHub Secrets (see QUICK_START.md)
# 2. Push to GitHub
git push origin main

# 3. Visit GitHub Actions to monitor deployment
# 4. Access your dashboard at the ALB URL provided
```

**[📖 Full Deployment Guide](./QUICK_START.md)**

### Local Development

```bash
# 1. Use Node.js 22 (recommended via nvm)
nvm use
# Or install: nvm install 22

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your Binance API keys

# 4. Run in development mode
npm run dev

# 5. Open dashboard
open http://localhost:3002
```

## 📋 Requirements

- **Node.js** 22.x - **Required for compatibility**
- **npm** 10.0.0 or higher
- **Binance.US Account** with API access
- **AWS Account** (for production deployment)
- **Minimum Capital**: $500 per trading pair recommended

> **Note**: Node 22.x is required for consistent behavior across local development, CI/CD, and production. Use `nvm use` to automatically switch to the correct version.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (React-like)               │
│  Portfolio View  │  Grid Viz  │  Risk Mgmt  │  Analytics   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼ WebSocket
┌─────────────────────────────────────────────────────────────┐
│               Express.js API Server                          │
│  /api/status  │  /api/grid  │  /api/trades  │  /api/risk   │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌───────────────┐ ┌────────────┐ ┌──────────────┐
│ Portfolio Bot │ │ Risk Mgr   │ │ Correlation  │
│ - Multi-pair  │ │ - Circuits │ │ - Analysis   │
│ - Allocation  │ │ - Limits   │ │ - Volatility │
└───────┬───────┘ └──────┬─────┘ └──────┬───────┘
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                ┌────────────────┐
                │  Binance API   │
                │  - WebSocket   │
                │  - REST        │
                └────────────────┘
```

## 📊 Trading Strategy

### Grid Trading Basics

1. Define price range (upper/lower bounds)
2. Create N grid levels with equal spacing
3. Place buy orders below current price
4. Place sell orders above current price
5. When buy fills → place sell one level up
6. When sell fills → place buy one level down
7. Profit = spread between levels - fees

### Recommended Pairs

- **DOGE/USDT** - High volatility, low correlation
- **XLM/USDT** - Payment-focused, stable

[See full configuration guide](./CLAUDE.md#recommended-pairs-for-binanceus)

## 🎯 Risk Strategies

| Strategy         | Exposure | Daily Loss | Drawdown | Consecutive Losses |
| ---------------- | -------- | ---------- | -------- | ------------------ |
| **Conservative** | 60%      | 2.5%       | 10%      | 3                  |
| **Moderate**     | 75%      | 5%         | 15%      | 5                  |
| **Aggressive**   | 90%      | 10%        | 25%      | 7                  |

## 🧪 Testing

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

**Test Coverage**: ~85% (200+ tests across unit, integration, and E2E)

[📖 Testing Guide](./tests/README.md)

## 📦 Deployment Options

### Option 1: Automatic (GitHub Actions)

- Push to main branch
- Automated testing, building, and deployment
- Zero-downtime updates
- [Setup Guide](./DEPLOYMENT.md#automatic-deployment)

### Option 2: Quick Script

```bash
./scripts/deploy.sh
# Follow interactive prompts
```

### Option 3: Manual Terraform

```bash
cd terraform
terraform init
terraform apply
```

[📖 Complete Deployment Guide](./DEPLOYMENT.md)

## 🔧 Configuration

### Environment Variables

```bash
# Binance API
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
BINANCE_US=true

# Portfolio Mode
PORTFOLIO_MODE=true
TOTAL_CAPITAL=2000
RISK_STRATEGY=moderate

# Simulation (KEEP TRUE INITIALLY!)
SIMULATION_MODE=true

# AWS Cognito (Production)
COGNITO_USER_POOL_ID=us-east-1_XXXXX
COGNITO_CLIENT_ID=your_client_id
COGNITO_REGION=us-east-1
```

[📖 Full Configuration Guide](./CLAUDE.md#configuration)

## 📡 API Endpoints

### Status & Configuration

- `GET /api/health` - Health check
- `GET /api/status` - Bot status
- `GET /api/config` - Configuration
- `GET /api/portfolio` - Portfolio state

### Trading Data

- `GET /api/grid` - Grid levels
- `GET /api/orders` - Active orders
- `GET /api/trades` - Trade history
- `GET /api/balances` - Account balances

### Controls

- `POST /api/portfolio/start` - Start trading
- `POST /api/stop` - Stop bot
- `PUT /api/simulation` - Toggle simulation
- `PUT /api/portfolio/strategy` - Change risk strategy

### Risk & Analytics

- `GET /api/risk/events` - Risk events
- `GET /api/correlation` - Correlation matrix

[📖 Full API Documentation](./CLAUDE.md#api-endpoints)

## 📂 Project Structure

```
cryptotrading/
├── src/
│   ├── bot/              # Trading bot logic
│   │   ├── grid.ts       # Single-pair grid bot
│   │   ├── portfolioBot.ts    # Multi-pair bot
│   │   ├── portfolioRisk.ts   # Risk management
│   │   └── risk.ts       # Basic risk rules
│   ├── exchange/         # Binance API integration
│   ├── analysis/         # Correlation & analytics
│   ├── models/           # Database models
│   ├── web/              # Express server & UI
│   ├── middleware/       # Auth & validation
│   └── utils/            # Config & logging
├── terraform/            # AWS infrastructure
│   ├── modules/
│   │   ├── networking/   # VPC, subnets
│   │   ├── compute/      # EC2, ALB
│   │   ├── cognito/      # Authentication
│   │   └── secrets/      # Secrets Manager
│   └── main.tf
├── tests/                # Test suite
│   ├── bot/              # Unit tests
│   ├── integration/      # API tests
│   └── e2e/              # Playwright tests
├── .github/workflows/    # CI/CD pipelines
├── scripts/              # Deployment scripts
└── data/                 # SQLite database
```

## 🔐 Security

- ✅ **IP-Restricted Access** - Configurable allowed IPs
- ✅ **Cognito Authentication** - JWT tokens with MFA support
- ✅ **Encrypted Secrets** - AWS Secrets Manager
- ✅ **HTTPS Only** - SSL/TLS encryption via ALB
  - Self-signed certificate (default) or custom domain with ACM
  - Automatic HTTP → HTTPS redirect
  - Modern TLS 1.3 support
- ✅ **Encrypted EBS** - Data encryption at rest
- ✅ **IMDSv2** - EC2 metadata security
- ✅ **Least Privilege IAM** - Minimal required permissions

[📖 Security Best Practices](./DEPLOYMENT.md#security-best-practices)
[🔒 Custom Domain SSL Setup](./terraform/SSL_CUSTOM_DOMAIN_GUIDE.md)

## 💰 Costs

**AWS Monthly Estimate**:

- EC2 t3.small: ~$15
- Application Load Balancer: ~$20
- Other services: ~$5
- **Total: ~$40/month**

[💡 Cost Optimization Tips](./terraform/README.md#cost-optimization)

## 📚 Documentation

- **[Quick Start](./QUICK_START.md)** - Fast deployment guide
- **[Full Deployment](./DEPLOYMENT.md)** - Comprehensive deployment docs
- **[Project Guide](./CLAUDE.md)** - Architecture and features
- **[Terraform Guide](./terraform/README.md)** - Infrastructure details
- **[Custom Domain SSL Setup](./terraform/SSL_CUSTOM_DOMAIN_GUIDE.md)** - Upgrade to trusted SSL certificate
- **[Testing Guide](./tests/README.md)** - Test documentation
- **[API Reference](./CLAUDE.md#api-endpoints)** - Complete API docs

## 🛠️ Development

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Start production build
npm start

# Run linter
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## ⚠️ Disclaimer

**This bot is for educational purposes.**

- Trading cryptocurrencies involves substantial risk
- You can lose all your invested capital
- Past performance does not guarantee future results
- ALWAYS test in simulation mode first
- Start with small amounts
- Never invest more than you can afford to lose
- Do your own research and understand the risks

**Use at your own risk. The authors are not responsible for financial losses.**

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

- Binance API for market data
- AWS for infrastructure
- Chart.js for visualizations
- The open-source community

---

**Built with ❤️ by crypto enthusiasts, for crypto enthusiasts**

**Happy Trading! 🚀📈**
