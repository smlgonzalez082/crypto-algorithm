#!/bin/bash
set -e

# Deployment script for trading bot

echo "=== Trading Bot Deployment Script ==="

# Check if we're on the EC2 instance
if [ ! -f /opt/trading-bot/.env ]; then
    echo "Error: .env file not found at /opt/trading-bot/.env"
    echo "Please create the .env file with your configuration"
    exit 1
fi

cd /opt/trading-bot

# Pull latest code (if using git)
if [ -d .git ]; then
    echo "Pulling latest code..."
    git pull origin main
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Build and start containers
echo "Building and starting containers..."
docker-compose down || true
docker-compose build --no-cache
docker-compose up -d

# Wait for health check
echo "Waiting for service to be healthy..."
sleep 10

# Check if service is running
if docker-compose ps | grep -q "Up"; then
    echo "=== Deployment successful! ==="
    echo "Web interface: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8000"
else
    echo "=== Deployment failed! ==="
    docker-compose logs
    exit 1
fi
