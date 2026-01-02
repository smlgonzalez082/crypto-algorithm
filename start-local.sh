#!/bin/bash
set -e

echo "🚀 Starting Crypto Grid Trading Bot (Local Development)"
echo "======================================================"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed!${NC}"
    echo "Please install Node.js 22.x from https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo -e "${RED}❌ Node.js version 22.x or higher is required!${NC}"
    echo "Current version: $(node -v)"
    echo "Please upgrade Node.js from https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✓ Node.js version:${NC} $(node -v)"
echo -e "${GREEN}✓ npm version:${NC} $(npm -v)"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found!${NC}"
    echo "📋 Creating .env from .env.example..."
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env file${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANT: Please update .env with your configuration:${NC}"
    echo "   1. Add your Binance API credentials (or leave as-is for simulation mode)"
    echo "   2. Set SERVER_PORT to your preferred port (default: 3002)"
    echo "   3. Keep SIMULATION_MODE=true for safe testing"
    echo ""
    echo -e "${BLUE}Press Enter to continue after updating .env, or Ctrl+C to exit...${NC}"
    read -r
else
    echo -e "${GREEN}✓ .env file found${NC}"
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo ""
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

# Create data directory if it doesn't exist
mkdir -p data

echo ""
echo -e "${BLUE}🔧 Configuration Summary:${NC}"
echo "================================"

# Read port from .env
PORT=$(grep -E "^SERVER_PORT=" .env | cut -d'=' -f2)
PORT=${PORT:-3002}

# Read simulation mode
SIM_MODE=$(grep -E "^SIMULATION_MODE=" .env | cut -d'=' -f2)
SIM_MODE=${SIM_MODE:-true}

# Read portfolio mode
PORTFOLIO=$(grep -E "^PORTFOLIO_MODE=" .env | cut -d'=' -f2)
PORTFOLIO=${PORTFOLIO:-true}

echo -e "Port:            ${GREEN}${PORT}${NC}"
echo -e "Simulation Mode: ${GREEN}${SIM_MODE}${NC}"
echo -e "Portfolio Mode:  ${GREEN}${PORTFOLIO}${NC}"
echo -e "Dashboard:       ${BLUE}http://localhost:${PORT}${NC}"
echo -e "Login Page:      ${BLUE}http://localhost:${PORT}/login.html${NC}"
echo ""

# Check if Cognito is configured
if grep -q "^COGNITO_USER_POOL_ID=us-east" .env 2>/dev/null; then
    echo -e "${GREEN}✓ Cognito authentication enabled${NC}"
else
    echo -e "${YELLOW}⚠️  Authentication disabled (dev mode)${NC}"
fi

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}🎯 Starting development server...${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo -e "${BLUE}📊 Dashboard will be available at:${NC} http://localhost:${PORT}"
echo -e "${BLUE}🔐 Login page:${NC} http://localhost:${PORT}/login.html"
echo ""
echo -e "${YELLOW}💡 Tip: The server auto-reloads on file changes!${NC}"
echo -e "${YELLOW}💡 Press Ctrl+C to stop the server${NC}"
echo ""

# Start the development server
npm run dev
