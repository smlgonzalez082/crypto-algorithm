#!/bin/bash

# Crypto Trading Bot - Quick Deployment Script
# This script automates the manual deployment process

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}Crypto Trading Bot - AWS Deploy${NC}"
echo -e "${GREEN}================================${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

command -v aws >/dev/null 2>&1 || { echo -e "${RED}Error: AWS CLI not installed${NC}"; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo -e "${RED}Error: Terraform not installed${NC}"; exit 1; }

echo -e "${GREEN}✓ Prerequisites OK${NC}"
echo ""

# Get user input
echo -e "${YELLOW}Please provide the following information:${NC}"
echo ""

read -p "Your email for Cognito: " COGNITO_EMAIL
read -p "Binance API Key: " BINANCE_KEY
read -sp "Binance API Secret: " BINANCE_SECRET
echo ""
read -p "EC2 SSH Key Name (in AWS): " SSH_KEY_NAME

echo ""
echo -e "${YELLOW}Getting your public IP...${NC}"
PUBLIC_IP=$(curl -s ifconfig.me)
echo -e "${GREEN}Your IP: $PUBLIC_IP${NC}"
echo ""

# Deploy with Terraform
cd terraform
cat > terraform.tfvars <<EOF
project_name        = "crypto-trading-bot"
environment         = "prod"
aws_region          = "us-east-1"
instance_type       = "t3.small"
allowed_ips         = ["$PUBLIC_IP/32"]
cognito_user_email  = "$COGNITO_EMAIL"
binance_api_key     = "$BINANCE_KEY"
binance_api_secret  = "$BINANCE_SECRET"
ssh_key_name        = "$SSH_KEY_NAME"
EOF

terraform init
terraform apply

echo -e "${GREEN}Deployment Complete! 🚀${NC}"
