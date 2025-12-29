# Crypto Trading Bot - AWS Deployment with Terraform

This directory contains Terraform configurations to deploy the crypto trading bot to AWS with secure authentication via AWS Cognito.

## Architecture Overview

```
┌─────────────┐
│   Internet  │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────┐
│  Application Load Balancer (HTTPS)   │
│  - SSL/TLS termination               │
│  - Health checks                     │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  EC2 Instance (Amazon Linux 2)       │
│  - Docker + Docker Compose           │
│  - Trading bot application           │
│  - CloudWatch agent                  │
└──────┬───────────────────────────────┘
       │
       ├─────► AWS Secrets Manager (API keys)
       ├─────► AWS Cognito (Authentication)
       └─────► CloudWatch Logs (Monitoring)
```

## Infrastructure Components

### Networking Module

- **VPC**: Isolated network for all resources
- **Public Subnets**: 2 subnets across availability zones
- **Internet Gateway**: Enables internet access
- **Route Tables**: Routes traffic between subnets and internet

### Cognito Module

- **User Pool**: Manages user authentication
- **App Client**: OAuth2 configuration for web dashboard
- **Hosted UI**: Pre-built login/signup pages
- **Security**: 12+ character passwords, optional MFA, advanced security mode

### Secrets Module

- **Secrets Manager**: Securely stores Binance API credentials
- **IAM Access**: EC2 instance can retrieve secrets at runtime
- **Recovery**: 7-day recovery window for accidental deletions

### Compute Module

- **EC2 Instance**: Runs the trading bot in Docker
- **Application Load Balancer**: HTTPS endpoint with health checks
- **Security Groups**: Restricts access to allowed IPs only
- **IAM Role**: Grants permissions for Secrets Manager and CloudWatch
- **Elastic IP**: Static IP address for SSH access
- **CloudWatch Logs**: Centralized logging

## Prerequisites

1. **AWS Account**: Active AWS account with appropriate permissions
2. **AWS CLI**: Installed and configured with credentials
   ```bash
   aws configure
   # Enter your AWS Access Key ID, Secret Access Key, and region
   ```
3. **Terraform**: Version 1.0 or higher

   ```bash
   # macOS
   brew install terraform

   # Linux
   wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip
   unzip terraform_1.6.0_linux_amd64.zip
   sudo mv terraform /usr/local/bin/
   ```

4. **SSH Key Pair**: Create in AWS EC2 console
   - AWS Console → EC2 → Key Pairs → Create key pair
   - Download the .pem file and save securely
5. **Binance.US API Keys**:
   - Visit https://www.binance.us/en/usercenter/settings/api-management
   - Create API key with "Enable Spot & Margin Trading" permission
   - Save API Key and Secret Key securely

## Deployment Steps

### 1. Configure Variables

Copy the example terraform.tfvars file:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and fill in all values:

```hcl
# Get your public IP address
# Run: curl ifconfig.me
allowed_ips = ["123.456.789.012/32"]

# Use the SSH key name you created in AWS
ssh_key_name = "my-trading-bot-key"

# Your email for Cognito admin user
cognito_user_email = "me@example.com"

# Your Binance API credentials
binance_api_key    = "your_actual_api_key"
binance_api_secret = "your_actual_api_secret"
```

**IMPORTANT**: Never commit `terraform.tfvars` to git! It contains sensitive credentials.

### 2. Initialize Terraform

```bash
terraform init
```

This downloads the required provider plugins (AWS, TLS).

### 3. Review the Deployment Plan

```bash
terraform plan
```

Review the resources that will be created. Ensure everything looks correct.

### 4. Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted. Deployment takes 5-10 minutes.

### 5. Retrieve Outputs

After successful deployment, Terraform will display important outputs:

```bash
# View all outputs
terraform output

# Specific outputs
terraform output alb_dns_name          # Dashboard URL
terraform output cognito_user_pool_id  # For Cognito management
terraform output instance_public_ip    # For SSH access
```

### 6. Get Initial Admin Password

The initial Cognito user is created with a temporary password. Retrieve it from AWS Console:

1. AWS Console → Cognito → User Pools
2. Select your pool: `crypto-trading-bot-dev`
3. Users → Select your email
4. The status shows "Force change password"

Alternatively, send a password reset email:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --username $(terraform output -raw cognito_user_email) \
  --password "TemporaryPassword123!" \
  --permanent
```

### 7. Access the Dashboard

1. Get the ALB DNS name:

   ```bash
   terraform output alb_dns_name
   ```

2. Open in browser:

   ```
   https://crypto-trading-bot-dev-alb-1234567890.us-east-1.elb.amazonaws.com
   ```

3. You'll see a certificate warning (self-signed cert). Click "Advanced" → "Proceed"

4. Log in with your Cognito credentials

### 8. Deploy Application Code

The EC2 instance is set up but doesn't have your application code yet. SSH into the instance and deploy:

```bash
# Get instance IP
INSTANCE_IP=$(terraform output -raw instance_public_ip)

# SSH into instance
ssh -i ~/.ssh/your-key.pem ec2-user@$INSTANCE_IP

# On the EC2 instance:
cd /opt/trading-bot

# Clone your repository (if public)
git clone https://github.com/yourusername/cryptotrading.git .

# OR upload code via scp from your local machine:
# scp -i ~/.ssh/your-key.pem -r /local/path/to/cryptotrading/* ec2-user@$INSTANCE_IP:/opt/trading-bot/

# Build Docker image
docker-compose build

# Start the bot
sudo systemctl start trading-bot

# Check status
sudo systemctl status trading-bot

# View logs
docker-compose logs -f
```

## Post-Deployment Configuration

### Enable MFA (Recommended)

1. AWS Console → Cognito → User Pools → Your pool
2. MFA and verifications → Edit
3. Change "Optional" to "Required"
4. Select "Authenticator app" (TOTP)

### Add Additional Users

```bash
aws cognito-idp admin-create-user \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --username newuser@example.com \
  --user-attributes Name=email,Value=newuser@example.com \
  --desired-delivery-mediums EMAIL
```

### Use Custom Domain with Trusted SSL Certificate

For production deployments, you can upgrade from the self-signed certificate to a trusted SSL certificate using a custom domain.

**Benefits:**

- No browser security warnings
- Professional appearance
- Trusted certificate verified by browsers
- Only ~$6-7/year additional cost

**See the detailed guide:** [SSL_CUSTOM_DOMAIN_GUIDE.md](./SSL_CUSTOM_DOMAIN_GUIDE.md)

The guide covers:

- Registering a domain via Route 53 or using an existing domain
- Setting up ACM certificate with automatic DNS validation
- Configuring Route 53 DNS records
- Updating infrastructure for production SSL
- Troubleshooting and maintenance

### Configure Cognito Custom Domain

```bash
# Set custom domain for Cognito Hosted UI
aws cognito-idp create-user-pool-domain \
  --domain your-custom-domain \
  --user-pool-id $(terraform output -raw cognito_user_pool_id)
```

## Monitoring and Maintenance

### View CloudWatch Logs

```bash
# From AWS Console
AWS Console → CloudWatch → Log groups → /aws/ec2/crypto-trading-bot-dev

# From CLI
aws logs tail /aws/ec2/crypto-trading-bot-dev --follow
```

### SSH Access

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip)
```

### Update Bot Configuration

```bash
# SSH into instance
ssh -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip)

# Edit .env file
cd /opt/trading-bot
sudo nano .env

# Restart bot
sudo systemctl restart trading-bot
```

### Update Binance API Keys

```bash
# Update secret in Secrets Manager
aws secretsmanager update-secret \
  --secret-id $(terraform output -raw secrets_name) \
  --secret-string '{"api_key":"NEW_KEY","api_secret":"NEW_SECRET"}'

# Restart bot to pick up new keys
ssh -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip)
sudo systemctl restart trading-bot
```

## Troubleshooting

### ALB Health Checks Failing

```bash
# SSH into instance
ssh -i ~/.ssh/your-key.pem ec2-user@$INSTANCE_IP

# Check if bot is running
sudo systemctl status trading-bot
docker ps

# Check bot logs
docker-compose logs

# Test health endpoint locally
curl http://localhost:3002/api/health
```

### Cannot Access Dashboard

1. **Check security group**: Ensure your IP is in `allowed_ips`

   ```bash
   curl ifconfig.me  # Verify your current IP
   ```

2. **Check ALB status**:
   - AWS Console → EC2 → Load Balancers
   - Verify targets are healthy

3. **Check DNS resolution**:
   ```bash
   nslookup $(terraform output -raw alb_dns_name)
   ```

### Cognito Authentication Issues

1. **Check User Pool configuration**:

   ```bash
   aws cognito-idp describe-user-pool \
     --user-pool-id $(terraform output -raw cognito_user_pool_id)
   ```

2. **Reset user password**:

   ```bash
   aws cognito-idp admin-set-user-password \
     --user-pool-id $(terraform output -raw cognito_user_pool_id) \
     --username your-email@example.com \
     --password "NewPassword123!" \
     --permanent
   ```

3. **Verify callback URLs**: Check that `callback_urls` in `terraform.tfvars` matches your ALB DNS name

### Bot Not Trading

1. **Check simulation mode**: Verify `.env` has `SIMULATION_MODE=false` for live trading
2. **Check API keys**: Ensure Secrets Manager has correct Binance credentials
3. **Check balance**: Verify USDT balance on Binance.US
4. **Check logs**: Look for API errors in CloudWatch or docker logs

### High AWS Costs

Current infrastructure costs approximately:

- **t3.small EC2**: ~$15/month
- **Application Load Balancer**: ~$20/month
- **Elastic IP**: Free while attached to running instance
- **CloudWatch Logs**: ~$0.50/GB ingested
- **Secrets Manager**: $0.40/secret/month

**Total**: ~$35-40/month

To reduce costs:

- Use `t3.micro` instead of `t3.small` (half the cost, but less performance)
- Delete ALB and access EC2 directly (not recommended for production)
- Reduce log retention in CloudWatch

## Cleanup

To destroy all infrastructure:

```bash
terraform destroy
```

Type `yes` when prompted. This will delete:

- All EC2 instances and associated resources
- Load balancers and target groups
- Security groups
- VPC and networking components
- Cognito User Pool (users will be deleted)
- CloudWatch log groups

**WARNING**: This is irreversible! Backup any important data first.

### Backup Before Destroying

```bash
# Backup database
scp -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip):/opt/trading-bot/data/trading.db ./backup-$(date +%Y%m%d).db

# Backup logs
ssh -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip)
cd /opt/trading-bot
tar -czf logs-backup.tar.gz logs/
exit

scp -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip):/opt/trading-bot/logs-backup.tar.gz .
```

## Security Best Practices

1. **Rotate API Keys**: Regularly rotate Binance API keys (monthly recommended)
2. **Enable MFA**: Require MFA for all Cognito users
3. **Restrict IP Access**: Only allow your IP in `allowed_ips`
4. **Monitor Logs**: Regularly review CloudWatch logs for suspicious activity
5. **Use HTTPS**: Never access over HTTP (ALB redirects automatically)
6. **Encrypt at Rest**: EBS volumes are encrypted by default
7. **Least Privilege IAM**: EC2 instance only has permissions for Secrets Manager and CloudWatch
8. **Keep Updated**: Regularly update Docker images and system packages

## Support

For issues with:

- **Terraform**: Check [Terraform AWS Provider docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- **AWS Cognito**: See [AWS Cognito documentation](https://docs.aws.amazon.com/cognito/)
- **Trading Bot**: Refer to main project README.md

## License

This infrastructure code is part of the crypto trading bot project. Use at your own risk.
