#!/bin/bash
set -e

echo "🚀 Deploying Crypto Trading Bot to EC2 (Direct Docker)..."

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

# Stop and remove old containers (plain Docker commands)
echo "🛑 Stopping existing containers..."
CONTAINER_ID=$(sudo docker ps -aq --filter name=trading-bot)
if [ -n "$CONTAINER_ID" ]; then
    echo "Found existing container: $CONTAINER_ID"
    sudo docker stop trading-bot 2>/dev/null || true
    sudo docker rm trading-bot 2>/dev/null || true
    echo "Waiting for cleanup..."
    sleep 3
fi

# Remove old image to force rebuild
echo "🗑️  Removing old image..."
sudo docker rmi trading-bot:latest 2>/dev/null || true

# Build Docker image
echo "🔨 Building Docker image..."
sudo docker build -t trading-bot:latest .

# Create/ensure volume exists
echo "📦 Creating volume..."
sudo docker volume create trading-bot-data 2>/dev/null || true

# Load environment variables
echo "🔧 Loading environment from .env..."
ENV_VARS=$(grep -v '^#' .env | grep -v '^$' | sed 's/^/-e /' | tr '\n' ' ')

# Start new container
echo "▶️  Starting container on port 9090..."
sudo docker run -d \
    --name trading-bot \
    --restart unless-stopped \
    -p 9090:9090 \
    -v trading-bot-data:/app/data \
    $ENV_VARS \
    -e NODE_ENV=production \
    -e SERVER_PORT=9090 \
    trading-bot:latest

# Wait for container to start
echo "⏳ Waiting for container to initialize..."
sleep 10

# Check container status
echo "📊 Container status:"
sudo docker ps --filter name=trading-bot

# Show application logs
echo ""
echo "📋 Application logs (last 30 lines):"
sudo docker logs trading-bot 2>&1 | tail -30

# Check if container is running
if sudo docker ps | grep -q trading-bot; then
    echo ""
    echo "✅ Deployment successful! Application is running on port 9090"
    echo "🌐 Access via ALB: https://crypto-trading-bot-prod-alb-1063612428.us-east-1.elb.amazonaws.com"
else
    echo ""
    echo "❌ Container failed to start. Check logs above for errors."
    exit 1
fi
