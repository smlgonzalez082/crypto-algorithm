#!/bin/bash
set -e

echo "🚀 Running Crypto Trading Bot directly (no Docker)..."

# Navigate to application directory
cd /opt/trading-bot

# Pull latest code
echo "📥 Pulling latest code from GitHub..."
sudo git pull origin main

# Update Cognito environment variables
echo "🔧 Updating Cognito configuration..."
sudo sed -i 's|^COGNITO_USER_POOL_ID=.*|COGNITO_USER_POOL_ID=us-east-1_qpNqlBGpq|' .env
sudo sed -i 's|^COGNITO_CLIENT_ID=.*|COGNITO_CLIENT_ID=6c7ksg2pkqa8plbumsbjhb82ae|' .env
sudo sed -i 's|^COGNITO_REGION=.*|COGNITO_REGION=us-east-1|' .env

echo "✅ Updated Cognito variables:"
grep COGNITO .env

# Install dependencies if needed
echo "📦 Installing dependencies..."
npm ci --omit=dev

# Build TypeScript
echo "🔨 Building application..."
npm run build

# Stop any Docker containers that might be running
echo "🛑 Stopping Docker containers (if any)..."
sudo docker rm -f $(sudo docker ps -aq --filter name=trading-bot) 2>/dev/null || true

# Load environment variables
echo "🔧 Loading environment variables..."
export $(grep -v '^#' .env | xargs)
export NODE_ENV=production
export SERVER_PORT=9090

# Run the application directly
echo "▶️  Starting application on port 9090 (direct Node.js)..."
echo "📋 Logs will appear below:"
echo "=========================================="

# Run with node directly
node dist/index.js
