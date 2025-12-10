#!/bin/bash
set -e

# EC2 Initial Setup Script
# Run this after SSH into the new EC2 instance

echo "=== EC2 Initial Setup for Trading Bot ==="

# Update system
echo "Updating system packages..."
sudo yum update -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo yum install -y docker
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker ec2-user
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Install Git
sudo yum install -y git

# Create app directory
sudo mkdir -p /opt/trading-bot
sudo chown ec2-user:ec2-user /opt/trading-bot

# Clone repository (replace with your repo URL)
# git clone https://github.com/yourusername/cryptotrading.git /opt/trading-bot

# Create .env file template
cat > /opt/trading-bot/.env.template << 'EOF'
# Binance API credentials
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here

# Use testnet for testing
BINANCE_TESTNET=true

# Trading configuration
TRADING_PAIR=BTCUSDT
GRID_UPPER=45000
GRID_LOWER=40000
GRID_COUNT=10
GRID_AMOUNT=0.001

# Mode
SIMULATION_MODE=true

# Logging
LOG_LEVEL=INFO
EOF

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Copy your application files to /opt/trading-bot/"
echo "2. Create .env file: cp /opt/trading-bot/.env.template /opt/trading-bot/.env"
echo "3. Edit .env file with your Binance API credentials"
echo "4. Run: cd /opt/trading-bot && docker-compose up -d"
echo ""
echo "NOTE: You may need to log out and back in for docker group to take effect"
