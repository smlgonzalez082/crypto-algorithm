# 🚀 Quick Start - Deploy to AWS

Choose your deployment method:

## Option 1: Automatic Deployment (Recommended)

**1. Configure GitHub Secrets**

Go to: `GitHub Repository → Settings → Secrets → Actions`

Add these secrets:
```
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
ALLOWED_IPS=["YOUR.IP.HERE/32"]  # Get IP: curl ifconfig.me
COGNITO_USER_EMAIL=you@example.com
BINANCE_API_KEY=your_binance_key
BINANCE_API_SECRET=your_binance_secret
SSH_KEY_NAME=your-ec2-key-name
SSH_PRIVATE_KEY=<paste entire .pem file>
```

**2. Push to GitHub**

```bash
git push origin main
```

**3. Monitor Deployment**

Go to: `GitHub → Actions → Deploy to AWS`

The pipeline will:
- ✅ Run tests
- ✅ Build Docker image
- ✅ Deploy infrastructure
- ✅ Deploy application
- ✅ Run health check

**4. Access Dashboard**

Check GitHub Actions output for dashboard URL:
```
Dashboard: https://crypto-trading-bot-prod-alb-XXXXX.elb.amazonaws.com
```

---

## Option 2: Quick Script Deployment

**1. Run deployment script**

```bash
cd scripts
./deploy.sh
```

**2. Follow prompts**

The script will ask for:
- Email address
- Binance API credentials
- SSH key name

It automatically:
- Gets your IP address
- Creates terraform.tfvars
- Deploys infrastructure
- Shows deployment outputs

---

## Option 3: Manual Deployment

**1. Configure Terraform**

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
```

**2. Deploy**

```bash
terraform init
terraform plan
terraform apply
```

**3. Deploy Application**

```bash
# Get instance IP
INSTANCE_IP=$(terraform output -raw instance_public_ip)

# SSH and deploy
ssh -i ~/.ssh/your-key.pem ec2-user@$INSTANCE_IP
cd /opt/trading-bot
git clone https://github.com/YOUR_REPO.git .
docker-compose build
sudo systemctl start trading-bot
```

---

## After Deployment

### 1. Get Cognito Password

**Via AWS Console:**
- Cognito → User Pools → Your pool → Users → Reset password

**Via CLI:**
```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --username your-email@example.com \
  --password "YourSecurePassword123!" \
  --permanent
```

### 2. Access Dashboard

1. Open ALB DNS URL (from terraform output)
2. Accept certificate warning (self-signed)
3. Login with Cognito
4. Verify **SIMULATION MODE** is ON

### 3. Monitor

```bash
# SSH to server
ssh -i ~/.ssh/your-key.pem ec2-user@INSTANCE_IP

# View logs
docker-compose logs -f

# Check status
sudo systemctl status trading-bot
```

---

## Important Commands

### View Outputs
```bash
cd terraform
terraform output
```

### SSH to Server
```bash
ssh -i ~/.ssh/your-key.pem ec2-user@$(terraform output -raw instance_public_ip)
```

### Update Bot
```bash
# On EC2
cd /opt/trading-bot
git pull
docker-compose build
sudo systemctl restart trading-bot
```

### View Logs
```bash
# Local CloudWatch
aws logs tail /aws/ec2/crypto-trading-bot-prod --follow

# On EC2
docker-compose logs -f
```

### Destroy Everything
```bash
cd terraform
terraform destroy
```

---

## Cost Estimate

Monthly costs:
- EC2 t3.small: ~$15
- Application Load Balancer: ~$20
- Other services: ~$5
- **Total: ~$40/month**

---

## Security Checklist

- ✅ Using simulation mode initially
- ✅ IP restricted access
- ✅ API keys in Secrets Manager
- ✅ HTTPS enabled
- ✅ Strong Cognito password
- ⚠️ Enable MFA (recommended)
- ⚠️ Use custom domain for production (optional)

---

## Troubleshooting

**Can't access dashboard?**
→ Check security group has your IP: `curl ifconfig.me`

**Bot not trading?**
→ Check simulation mode, API keys, and USDT balance

**Health check fails?**
→ Check logs: `docker-compose logs`

**Deployment fails?**
→ Check GitHub Actions logs or Terraform output

---

## Full Documentation

- **Complete Guide**: [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Terraform Docs**: [terraform/README.md](./terraform/README.md)
- **Testing Guide**: [tests/README.md](./tests/README.md)

---

**Ready to deploy? Start with Option 1 (Automatic) for easiest setup! 🚀**
