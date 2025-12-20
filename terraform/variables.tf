variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "crypto-trading-bot"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "allowed_ips" {
  description = "List of IPs allowed to access the dashboard"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Change this to your IP for production
}

variable "domain_name" {
  description = "Domain name for the application (optional)"
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ARN of ACM certificate for HTTPS (optional)"
  type        = string
  default     = ""
}

variable "cognito_user_email" {
  description = "Email for the initial Cognito user"
  type        = string
}

variable "binance_api_key" {
  description = "Binance API key (will be stored in Secrets Manager)"
  type        = string
  sensitive   = true
}

variable "binance_api_secret" {
  description = "Binance API secret (will be stored in Secrets Manager)"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of the SSH key pair for EC2 access"
  type        = string
}
