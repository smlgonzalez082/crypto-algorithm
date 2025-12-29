# SSL Custom Domain Setup Guide

This guide explains how to upgrade from the self-signed certificate to a trusted SSL certificate using AWS Certificate Manager (ACM) with a custom domain.

## Why Upgrade?

**Current Setup (Self-Signed Certificate):**

- Browser security warnings on every visit
- Users must manually accept certificate
- Not suitable for production/sharing with others
- Still encrypted, but not verified

**With Custom Domain + ACM:**

- No browser warnings
- Trusted SSL certificate (verified by browser)
- Professional appearance
- Better for production use

## Prerequisites

- Custom domain name (e.g., `trading-bot.example.com`)
- Access to domain DNS settings (Route53 or external registrar)
- Existing infrastructure deployed via Terraform

## Option 1: Register New Domain via Route 53

### Step 1: Register Domain

```bash
# Search for available domains
aws route53domains check-domain-availability --domain-name trading-bot-example.com

# Register domain (costs ~$12-15/year for .com)
aws route53domains register-domain \
  --domain-name trading-bot-example.com \
  --duration-in-years 1 \
  --admin-contact file://contact.json \
  --registrant-contact file://contact.json \
  --tech-contact file://contact.json
```

**contact.json:**

```json
{
  "FirstName": "John",
  "LastName": "Doe",
  "ContactType": "PERSON",
  "OrganizationName": "Personal",
  "AddressLine1": "123 Main St",
  "City": "Seattle",
  "State": "WA",
  "CountryCode": "US",
  "ZipCode": "98101",
  "PhoneNumber": "+1.2065551234",
  "Email": "admin@example.com"
}
```

### Step 2: Wait for Registration

Domain registration takes 15 minutes to 24 hours. Check status:

```bash
aws route53domains get-domain-detail --domain-name trading-bot-example.com
```

## Option 2: Use Existing Domain from External Registrar

### Step 1: Create Hosted Zone in Route 53

```bash
# Create hosted zone
aws route53 create-hosted-zone \
  --name trading-bot.example.com \
  --caller-reference $(date +%s)
```

### Step 2: Update DNS Nameservers

1. Get Route 53 nameservers:

   ```bash
   aws route53 list-hosted-zones-by-name --dns-name trading-bot.example.com
   ```

2. Copy the four nameservers (e.g., `ns-123.awsdns-12.com`)

3. Update nameservers at your domain registrar:
   - GoDaddy: Domain Settings → Nameservers → Change → Custom
   - Namecheap: Domain List → Manage → Nameservers → Custom DNS
   - Google Domains: DNS → Name servers → Use custom name servers

4. Wait for DNS propagation (up to 48 hours, usually 1-4 hours)

5. Verify propagation:
   ```bash
   dig NS trading-bot.example.com
   ```

## Infrastructure Updates

### Step 1: Create ACM Module

Create `terraform/modules/acm/main.tf`:

```hcl
resource "aws_acm_certificate" "main" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = {
    Name = "${var.project_name}-${var.environment}-cert"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
```

Create `terraform/modules/acm/variables.tf`:

```hcl
variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment"
  type        = string
}

variable "domain_name" {
  description = "Domain name for SSL certificate"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID"
  type        = string
}
```

Create `terraform/modules/acm/outputs.tf`:

```hcl
output "certificate_arn" {
  description = "ARN of validated ACM certificate"
  value       = aws_acm_certificate_validation.main.certificate_arn
}
```

### Step 2: Create Route 53 Module

Create `terraform/modules/route53/main.tf`:

```hcl
data "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 0 : 1
  name  = var.domain_name
}

resource "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.domain_name

  tags = {
    Name = "${var.project_name}-${var.environment}-zone"
  }
}

locals {
  zone_id = var.create_hosted_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.main[0].zone_id
}

resource "aws_route53_record" "alb" {
  zone_id = local.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}
```

Create `terraform/modules/route53/variables.tf`:

```hcl
variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment"
  type        = string
}

variable "domain_name" {
  description = "Domain name"
  type        = string
}

variable "create_hosted_zone" {
  description = "Whether to create a new hosted zone"
  type        = bool
  default     = false
}

variable "alb_dns_name" {
  description = "ALB DNS name"
  type        = string
}

variable "alb_zone_id" {
  description = "ALB zone ID"
  type        = string
}
```

Create `terraform/modules/route53/outputs.tf`:

```hcl
output "zone_id" {
  description = "Route 53 hosted zone ID"
  value       = local.zone_id
}

output "nameservers" {
  description = "Nameservers for the hosted zone"
  value       = var.create_hosted_zone ? aws_route53_zone.main[0].name_servers : null
}
```

### Step 3: Update Compute Module

Edit `terraform/modules/compute/main.tf`:

**Replace the self-signed certificate resources (lines 327-357) with:**

```hcl
# Use ACM certificate if provided, otherwise create self-signed
resource "tls_private_key" "main" {
  count     = var.acm_certificate_arn == "" ? 1 : 0
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "main" {
  count           = var.acm_certificate_arn == "" ? 1 : 0
  private_key_pem = tls_private_key.main[0].private_key_pem

  subject {
    common_name  = "${var.project_name}.local"
    organization = var.project_name
  }

  validity_period_hours = 8760 # 1 year

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

resource "aws_acm_certificate" "self_signed" {
  count            = var.acm_certificate_arn == "" ? 1 : 0
  private_key      = tls_private_key.main[0].private_key_pem
  certificate_body = tls_self_signed_cert.main[0].cert_pem

  tags = {
    Name = "${var.project_name}-${var.environment}-cert-self-signed"
  }
}

locals {
  certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : aws_acm_certificate.self_signed[0].arn
}
```

**Update the HTTPS listener (line 314-325):**

```hcl
# HTTPS Listener
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06" # Modern TLS policy
  certificate_arn   = local.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}
```

Edit `terraform/modules/compute/variables.tf` and add:

```hcl
variable "acm_certificate_arn" {
  description = "ARN of ACM certificate (optional, uses self-signed if not provided)"
  type        = string
  default     = ""
}
```

Edit `terraform/modules/compute/outputs.tf` and add:

```hcl
output "alb_zone_id" {
  description = "Zone ID of Application Load Balancer"
  value       = aws_lb.main.zone_id
}
```

### Step 4: Update Root Module

Edit `terraform/main.tf` and add:

```hcl
# Route 53 (optional - only if using custom domain)
module "route53" {
  count  = var.domain_name != "" ? 1 : 0
  source = "./modules/route53"

  project_name        = var.project_name
  environment         = var.environment
  domain_name         = var.domain_name
  create_hosted_zone  = var.create_hosted_zone
  alb_dns_name        = module.compute.alb_dns_name
  alb_zone_id         = module.compute.alb_zone_id
}

# ACM Certificate (optional - only if using custom domain)
module "acm" {
  count  = var.domain_name != "" ? 1 : 0
  source = "./modules/acm"

  project_name   = var.project_name
  environment    = var.environment
  domain_name    = var.domain_name
  hosted_zone_id = module.route53[0].zone_id
}

# Update compute module to use ACM certificate
module "compute" {
  source = "./modules/compute"

  # ... existing variables ...
  acm_certificate_arn = var.domain_name != "" ? module.acm[0].certificate_arn : ""
}
```

Edit `terraform/variables.tf` and add:

```hcl
variable "domain_name" {
  description = "Custom domain name (optional, leave empty to use self-signed cert with ALB DNS)"
  type        = string
  default     = ""
}

variable "create_hosted_zone" {
  description = "Create new Route 53 hosted zone (set false if zone already exists)"
  type        = bool
  default     = false
}
```

Edit `terraform/outputs.tf` and add:

```hcl
output "custom_domain_url" {
  description = "Custom domain URL (if configured)"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : null
}

output "route53_nameservers" {
  description = "Route 53 nameservers (if hosted zone was created)"
  value       = var.domain_name != "" && var.create_hosted_zone ? module.route53[0].nameservers : null
}
```

### Step 5: Update terraform.tfvars

Add to your `terraform.tfvars`:

```hcl
# Custom domain configuration (optional)
domain_name        = "trading-bot.example.com"
create_hosted_zone = true  # Set false if zone already exists
```

### Step 6: Update Cognito Callback URLs

Edit `terraform/main.tf` and update the Cognito module:

```hcl
module "cognito" {
  source = "./modules/cognito"

  project_name = var.project_name
  environment  = var.environment
  user_email   = var.cognito_user_email

  # Use custom domain if provided, otherwise ALB DNS
  callback_urls = var.domain_name != "" ? [
    "https://${var.domain_name}",
    "https://${var.domain_name}/callback"
  ] : [
    "https://${module.compute.alb_dns_name}",
    "https://${module.compute.alb_dns_name}/callback"
  ]

  logout_urls = var.domain_name != "" ? [
    "https://${var.domain_name}"
  ] : [
    "https://${module.compute.alb_dns_name}"
  ]
}
```

## Deployment

### Step 1: Plan Changes

```bash
cd terraform
terraform plan
```

Review the changes. You should see:

- Route 53 hosted zone (if creating new)
- Route 53 A record pointing to ALB
- ACM certificate
- ACM validation records
- Updated ALB listener with ACM certificate
- Updated Cognito callback URLs

### Step 2: Apply Changes

```bash
terraform apply
```

Type `yes` when prompted. This process takes 5-10 minutes due to:

- ACM certificate DNS validation (~2-5 minutes)
- Route 53 propagation (~2-5 minutes)

### Step 3: Verify Setup

```bash
# Check certificate validation
terraform output custom_domain_url

# Test DNS resolution
dig trading-bot.example.com

# Test HTTPS connection
curl -I https://trading-bot.example.com/api/health

# If you created a hosted zone, note the nameservers
terraform output route53_nameservers
```

### Step 4: Update External DNS (if applicable)

If you created a new hosted zone and your domain is registered outside AWS, update your registrar's nameservers with the values from `route53_nameservers` output.

## Verification

### 1. Test in Browser

Visit your custom domain:

```
https://trading-bot.example.com
```

You should see:

- No certificate warnings
- Green padlock in address bar
- "Connection is secure"

### 2. Check Certificate Details

Click the padlock → Certificate → Details:

- Issued by: Amazon
- Valid for your domain
- Expiry date (auto-renewed by AWS)

### 3. Test HTTP Redirect

Visit HTTP version:

```
http://trading-bot.example.com
```

Should automatically redirect to HTTPS.

## Troubleshooting

### Certificate Validation Stuck

**Issue:** ACM certificate stuck in "Pending validation"

**Solution:**

```bash
# Check Route 53 validation records
aws route53 list-resource-record-sets \
  --hosted-zone-id $(terraform output -raw route53_zone_id)

# Verify CNAME exists for _acm-challenge
dig _acm-challenge.trading-bot.example.com CNAME

# If missing, re-apply Terraform
terraform apply -auto-approve
```

### Domain Not Resolving

**Issue:** Domain doesn't resolve to ALB

**Solution:**

```bash
# Check Route 53 A record
aws route53 list-resource-record-sets \
  --hosted-zone-id $(terraform output -raw route53_zone_id) \
  --query "ResourceRecordSets[?Name=='trading-bot.example.com.']"

# Check ALB is accessible via DNS
curl -I https://$(terraform output -raw alb_dns_name)/api/health

# Flush local DNS cache
# macOS:
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# Linux:
sudo systemd-resolve --flush-caches

# Windows:
ipconfig /flushdns
```

### Cognito Redirect Issues

**Issue:** After login, redirected to wrong URL

**Solution:**

```bash
# Check callback URLs
aws cognito-idp describe-user-pool-client \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --client-id $(terraform output -raw cognito_client_id)

# Update if needed
terraform apply -auto-approve
```

### Mixed Content Warnings

**Issue:** Some resources load over HTTP

**Solution:** Ensure your application uses relative URLs or HTTPS URLs for all assets, API calls, and WebSocket connections.

## Cost Implications

Adding custom domain increases costs slightly:

- **Route 53 Hosted Zone**: $0.50/month
- **Route 53 Queries**: $0.40 per million queries (~$0.01/month for typical use)
- **ACM Certificate**: FREE (no additional cost)
- **Domain Registration**: $12-15/year (if using Route 53)

**Total Additional Cost**: ~$6-7/year

## Rollback

To revert to self-signed certificate:

```bash
# Update terraform.tfvars
domain_name = ""

# Apply changes
terraform apply

# Or manually destroy resources
terraform destroy -target=module.acm
terraform destroy -target=module.route53
```

## Security Considerations

1. **Certificate Auto-Renewal**: ACM automatically renews certificates before expiry
2. **TLS Version**: Uses modern TLS 1.3 for better security
3. **HTTPS Enforcement**: HTTP automatically redirects to HTTPS
4. **DNS Security**: Consider enabling DNSSEC on Route 53 for additional protection

## Maintenance

ACM certificates are managed by AWS:

- Auto-renewed before expiry
- No manual intervention required
- Renewal notifications sent to email
- Valid for 13 months, renewed at 12 months

## Next Steps

After setting up custom domain:

1. **Update .env files** to use custom domain instead of ALB DNS
2. **Configure monitoring** for certificate expiry (though auto-renewed)
3. **Set up CloudWatch alarms** for Route 53 health checks
4. **Consider WAF** for additional application security
5. **Enable Route 53 query logging** for audit trail

## Summary

You've successfully upgraded from a self-signed certificate to a trusted SSL certificate! Your trading bot now:

- Uses a custom domain name
- Has a trusted SSL certificate (no browser warnings)
- Automatically renews certificates
- Looks professional and production-ready

For questions or issues, refer to:

- [AWS ACM Documentation](https://docs.aws.amazon.com/acm/)
- [AWS Route 53 Documentation](https://docs.aws.amazon.com/route53/)
- Main project README.md
