# AWS Deployment Guide

This guide covers both **automated CI/CD deployment** via GitHub Actions and **manual deployment** using Terraform.

## 🚀 Automatic Deployment (Recommended)

### Prerequisites

1. **AWS Account** with appropriate permissions
2. **GitHub Repository** with this code
3. **SSH Key Pair** created in AWS EC2
4. **Binance API Keys** from Binance.US

### Step 1: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add the following secrets:

| Secret Name             | Description                    | Example                                    |
| ----------------------- | ------------------------------ | ------------------------------------------ |
| `AWS_ACCESS_KEY_ID`     | AWS IAM access key             | `AKIAIOSFODNN7EXAMPLE`                     |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key             | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `ALLOWED_IPS`           | Your IP addresses (JSON array) | `["123.45.67.89/32"]`                      |
| `COGNITO_USER_EMAIL`    | Your email for admin account   | `you@example.com`                          |
| `BINANCE_API_KEY`       | Binance API key                | Your API key                               |
| `BINANCE_API_SECRET`    | Binance API secret             | Your API secret                            |
| `SSH_KEY_NAME`          | Name of EC2 SSH key pair       | `my-trading-bot-key`                       |
| `SSH_PRIVATE_KEY`       | Private SSH key (entire file)  | `-----BEGIN RSA PRIVATE KEY-----...`       |

### Step 2: Get Your Public IP

```bash
curl ifconfig.me
```

Use this in `ALLOWED_IPS` secret as: `["YOUR.IP.HERE/32"]`

### Step 3: Create AWS IAM User

1. Go to AWS Console → IAM → Users → Create user
2. User name: `github-actions-deploy`
3. Attach policies:
   - `AmazonEC2FullAccess`
   - `AmazonVPCFullAccess`
   - `IAMFullAccess`
   - `SecretsManagerReadWrite`
   - `CloudWatchLogsFullAccess`
   - `AmazonCognitoPowerUser`
   - `AmazonEC2ContainerRegistryFullAccess`

4. Create access key → Use case: Application running outside AWS
5. Save `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

### Step 4: Create EC2 SSH Key Pair

```bash
# In AWS Console
EC2 → Key Pairs → Create key pair

Name: crypto-trading-bot-key
Type: RSA
Format: .pem

# Download the .pem file
# Add the content to GitHub secret SSH_PRIVATE_KEY
```

### Step 5: Create Production Environment (Optional - for manual approval)

1. Go to GitHub repository → Settings → Environments
2. Click "New environment"
3. Name: `production`
4. Add protection rules:
   - ✅ Required reviewers (add yourself)
   - ✅ Wait timer: 0 minutes

This adds a manual approval step before Terraform applies changes.

### Step 6: Trigger Deployment

**Automatic Trigger:**

```bash
git add .
git commit -m "Deploy to AWS"
git push origin main
```

**Manual Trigger:**

1. Go to GitHub → Actions → Deploy to AWS
2. Click "Run workflow"
3. Select branch: `main`
4. Click "Run workflow"

### Step 7: Monitor Deployment

Go to GitHub → Actions → Deploy to AWS → Latest run

The pipeline will:

1. ✅ Run all tests
2. ✅ Build Docker image and push to ECR
3. ✅ Run Terraform plan
4. ⏸️ Wait for approval (if production environment configured)
5. ✅ Apply Terraform infrastructure
6. ✅ Deploy application to EC2
7. ✅ Run health check
8. ✅ Notify success/failure

### Step 8: Access Your Dashboard

After successful deployment, the workflow will output:

```
Dashboard: https://crypto-trading-bot-prod-alb-XXXXX.us-east-1.elb.amazonaws.com
```

1. Open this URL in your browser
2. Accept the self-signed certificate warning
3. You'll be redirected to Cognito login
4. Check your email for temporary password
5. Login and set new password

---

## 🛠️ Manual Deployment

If you prefer to deploy manually or the CI/CD isn't working:

### Prerequisites

1. **AWS CLI** installed and configured
2. **Terraform** installed (v1.6+)
3. **Docker** installed
4. **SSH Key Pair** in AWS

### Step 1: Configure AWS CLI

```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Default region: us-east-1
# Default output format: json
```

### Step 2: Create terraform.tfvars

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
project_name        = "crypto-trading-bot"
environment         = "prod"
aws_region          = "us-east-1"
instance_type       = "t3.small"
allowed_ips         = ["YOUR.IP.ADDRESS/32"]  # Get with: curl ifconfig.me
cognito_user_email  = "your-email@example.com"
binance_api_key     = "YOUR_BINANCE_API_KEY"
binance_api_secret  = "YOUR_BINANCE_API_SECRET"
ssh_key_name        = "your-ec2-key-name"
```

### Step 3: Initialize Terraform

```bash
cd terraform
terraform init
```

### Step 4: Review Infrastructure Plan

```bash
terraform plan
```

Review the resources that will be created:

- VPC and networking
- EC2 instance
- Application Load Balancer
- Cognito User Pool
- Secrets Manager
- Security groups
- IAM roles

### Step 5: Apply Infrastructure

```bash
terraform apply
```

Type `yes` when prompted.

This takes 5-10 minutes.

### Step 6: Get Outputs

```bash
# Get all outputs
terraform output

# Specific outputs
terraform output alb_dns_name
terraform output instance_public_ip
terraform output cognito_user_pool_id
```

### Step 7: Deploy Application Code

```bash
# Get instance IP
INSTANCE_IP=$(terraform output -raw instance_public_ip)

# SSH into instance
ssh -i ~/.ssh/your-key.pem ec2-user@$INSTANCE_IP

# On the EC2 instance:
cd /opt/trading-bot

# Clone your repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git .

# Build Docker image
docker-compose build

# Start the bot
sudo systemctl start trading-bot

# Check status
sudo systemctl status trading-bot

# View logs
docker-compose logs -f
```

### Step 8: Verify Deployment

```bash
# Check health endpoint
curl http://$INSTANCE_IP:3002/api/health

# Should return: {"status":"ok","timestamp":"..."}
```

### Step 9: Access Dashboard

1. Get ALB DNS: `terraform output alb_dns_name`
2. Open in browser: `https://[ALB-DNS-NAME]`
3. Accept certificate warning
4. Login with Cognito

---

## 📋 Post-Deployment Configuration

### Get Cognito Temporary Password

The initial user is created with a temporary password. To get it:

**Option 1: Reset password via AWS Console**

1. AWS Console → Cognito → User Pools
2. Select your pool: `crypto-trading-bot-prod`
3. Users → Select your email
4. Actions → Reset password
5. Check your email

**Option 2: Set password via CLI**

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --username $(terraform output -raw cognito_user_email) \
  --password "YourSecurePassword123!" \
  --permanent
```

### Update Application Configuration

SSH into the EC2 instance and edit `.env`:

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip)
cd /opt/trading-bot
sudo nano .env
```

Important settings:

```bash
# IMPORTANT: Keep this TRUE initially!
SIMULATION_MODE=true

# Change to false only when ready for real trading
# SIMULATION_MODE=false

# Portfolio settings
TOTAL_CAPITAL=2000
RISK_STRATEGY=moderate  # conservative, moderate, aggressive
```

Restart after changes:

```bash
sudo systemctl restart trading-bot
```

### Enable Real Trading (When Ready)

⚠️ **WARNING**: Only do this when you're ready to trade with real money!

1. SSH into EC2 instance
2. Edit `/opt/trading-bot/.env`
3. Change `SIMULATION_MODE=false`
4. Restart: `sudo systemctl restart trading-bot`

### Monitor the Bot

**View Logs:**

```bash
# System logs
sudo journalctl -u trading-bot -f

# Docker logs
docker-compose logs -f

# CloudWatch Logs (from local machine)
aws logs tail /aws/ec2/crypto-trading-bot-prod --follow
```

**Dashboard:**

- Access via ALB DNS name
- Monitor portfolio value, PnL, active trades
- View risk events and circuit breakers

---

## 🔄 Update Deployment

### Update via GitHub (Automatic)

Simply push to main branch:

```bash
git add .
git commit -m "Update trading parameters"
git push origin main
```

The CI/CD pipeline will automatically deploy.

### Update Manually

```bash
# SSH into EC2
ssh -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip)

cd /opt/trading-bot

# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose build
sudo systemctl restart trading-bot
```

---

## 🗑️ Destroy Infrastructure

### Via Terraform

```bash
cd terraform
terraform destroy
```

Type `yes` when prompted.

This will delete ALL AWS resources:

- EC2 instance and all data
- Load balancer
- Cognito User Pool (users deleted)
- VPC and networking
- Secrets

⚠️ **Backup your data first!**

```bash
# Backup database
scp -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip):/opt/trading-bot/data/trading.db ./backup-$(date +%Y%m%d).db
```

---

## 🔐 Security Best Practices

### 1. Rotate API Keys Regularly

```bash
# Update in Secrets Manager
aws secretsmanager update-secret \
  --secret-id $(terraform output -raw secrets_name) \
  --secret-string '{"api_key":"NEW_KEY","api_secret":"NEW_SECRET"}'

# Restart bot
ssh -i ~/.ssh/your-key.pem ec2-user@$INSTANCE_IP
sudo systemctl restart trading-bot
```

### 2. Enable MFA for Cognito

1. AWS Console → Cognito → User Pools → Your pool
2. Sign-in experience → MFA → Edit
3. Select "Required" and "Authenticator apps"
4. Save changes

### 3. Use Custom Domain (Production)

1. Register domain (Route 53 or external)
2. Request ACM certificate for your domain
3. Update ALB to use ACM certificate
4. Create Route 53 alias record to ALB

### 4. Restrict IP Access

Only allow your IP:

```bash
# Update allowed_ips in terraform.tfvars
allowed_ips = ["YOUR.CURRENT.IP/32"]

# Apply changes
terraform apply
```

### 5. Monitor CloudWatch Alarms

Set up alarms for:

- High CPU usage
- Failed health checks
- Large trading losses
- API errors

---

## 🐛 Troubleshooting

### Deployment Fails

**Check GitHub Actions logs:**

```
GitHub → Actions → Latest run → View logs
```

**Common issues:**

- AWS credentials invalid → Check secrets
- Terraform state locked → Wait or force unlock
- EC2 instance not ready → Increase wait time

### Can't Access Dashboard

1. **Check security group:**

   ```bash
   aws ec2 describe-security-groups \
     --filters "Name=tag:Name,Values=*alb-sg"
   ```

   Verify your IP is in allowed_ips

2. **Check ALB health:**

   ```bash
   aws elbv2 describe-target-health \
     --target-group-arn $(terraform output -raw target_group_arn)
   ```

3. **Check EC2 instance:**
   ```bash
   ssh -i ~/.ssh/your-key.pem ec2-user@$INSTANCE_IP
   sudo systemctl status trading-bot
   docker ps
   ```

### Bot Not Trading

1. **Check simulation mode:**

   ```bash
   cat /opt/trading-bot/.env | grep SIMULATION_MODE
   ```

2. **Check API keys:**

   ```bash
   aws secretsmanager get-secret-value \
     --secret-id $(terraform output -raw secrets_name)
   ```

3. **Check logs:**

   ```bash
   docker-compose logs --tail=100
   ```

4. **Check balance:**
   - Ensure you have USDT in Binance.US account
   - Minimum recommended: $500 per trading pair

### GitHub Actions Permission Denied

Add this to your GitHub Actions workflow if needed:

```yaml
permissions:
  contents: read
  id-token: write
```

---

## 📊 Monitoring

### CloudWatch Dashboards

Create a custom dashboard:

1. AWS Console → CloudWatch → Dashboards → Create dashboard
2. Add widgets for:
   - EC2 CPU utilization
   - ALB request count
   - Target health status
   - Log insights queries

### Cost Monitoring

Set up billing alerts:

1. AWS Console → Billing → Budgets
2. Create budget: Monthly budget = $50
3. Alert threshold: 80% of budget
4. Email notification to your address

**Estimated monthly costs:**

- EC2 t3.small: ~$15
- ALB: ~$20
- Data transfer: ~$5
- CloudWatch: ~$2
- Secrets Manager: ~$1
- **Total**: ~$40-45/month

---

## 🎯 Next Steps

1. ✅ Deploy infrastructure
2. ✅ Access dashboard and login
3. ✅ Verify bot is in simulation mode
4. 📊 Monitor for 24-48 hours in simulation
5. 📈 Review simulated trades and PnL
6. ⚙️ Adjust parameters if needed
7. 💰 Enable real trading (when confident)
8. 🔄 Set up regular monitoring routine

---

**Need help?** Check the logs, review the Terraform documentation, or open an issue on GitHub.

**Good luck with your trading bot! 🚀📈**
