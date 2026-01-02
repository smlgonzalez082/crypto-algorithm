#!/bin/bash
set -e

echo "🚀 Deploying Crypto Trading Bot to EC2..."

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

# Stop and remove old containers
echo "🛑 Stopping existing containers..."
# Use docker-compose down to cleanly stop and remove everything
sudo /usr/local/bin/docker-compose down 2>/dev/null || true
# Give Docker time to clean up
sleep 3
# Force remove any stray containers if they still exist
if sudo docker ps -aq --filter name=trading-bot | grep -q .; then
    echo "Removing stray containers..."
    sudo docker rm -f $(sudo docker ps -aq --filter name=trading-bot) 2>/dev/null || true
    sleep 2
fi

# Build and start in one operation to avoid race conditions
echo "🔨 Building and starting application on port 9090..."
sudo /usr/local/bin/docker-compose up -d --build --force-recreate

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
