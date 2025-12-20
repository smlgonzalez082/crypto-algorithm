#!/bin/bash
set -e

# Update system
yum update -y

# Install Docker
amazon-linux-extras install docker -y
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./aws/install

# Install CloudWatch Logs agent
yum install -y amazon-cloudwatch-agent

# Fetch secrets from Secrets Manager
SECRETS=$(aws secretsmanager get-secret-value --secret-id ${secrets_arn} --region ${aws_region} --query SecretString --output text)
BINANCE_API_KEY=$(echo $SECRETS | jq -r '.api_key')
BINANCE_API_SECRET=$(echo $SECRETS | jq -r '.api_secret')

# Create application directory
mkdir -p /opt/trading-bot
cd /opt/trading-bot

# Clone repository (you'll need to update this with your repo URL)
# For now, we'll assume code is deployed separately
# git clone https://github.com/yourusername/cryptotrading.git .

# Create .env file
cat > .env <<EOF
# Binance API (from Secrets Manager)
BINANCE_API_KEY=$BINANCE_API_KEY
BINANCE_API_SECRET=$BINANCE_API_SECRET
BINANCE_US=true
BINANCE_TESTNET=false

# Portfolio Mode
PORTFOLIO_MODE=true
TOTAL_CAPITAL=2000
RISK_STRATEGY=moderate

# Simulation Mode (KEEP THIS TRUE INITIALLY!)
SIMULATION_MODE=true

# Cognito Configuration
COGNITO_USER_POOL_ID=${cognito_user_pool_id}
COGNITO_CLIENT_ID=${cognito_client_id}
COGNITO_REGION=${aws_region}

# Server
SERVER_PORT=3001
LOG_LEVEL=info
EOF

# Create docker-compose.yml
cat > docker-compose.yml <<'EOFCOMPOSE'
version: '3.8'

services:
  trading-bot:
    build: .
    container_name: crypto-trading-bot
    ports:
      - "3001:3001"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    logging:
      driver: "awslogs"
      options:
        awslogs-region: "${aws_region}"
        awslogs-group: "/aws/ec2/${project_name}-${environment}"
        awslogs-stream: "trading-bot"
EOFCOMPOSE

# Create systemd service for Docker Compose
cat > /etc/systemd/system/trading-bot.service <<EOFSVC
[Unit]
Description=Crypto Trading Bot
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/trading-bot
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOFSVC

# Enable and start the service
systemctl daemon-reload
systemctl enable trading-bot.service

# Note: The actual docker-compose up will happen after you deploy your code
# For now, this just sets up the infrastructure

echo "Setup complete! Deploy your application code to /opt/trading-bot and run:"
echo "  systemctl start trading-bot"
