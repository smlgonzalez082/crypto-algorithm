terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket  = "crypto-trading-bot-terraform-state"
    key     = "crypto-trading-bot/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# VPC and Networking
module "networking" {
  source = "./modules/networking"

  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = "10.0.0.0/16"
}

# ECR Repository
module "ecr" {
  source = "./modules/ecr"

  project_name = var.project_name
  environment  = var.environment
}

# Cognito User Pool
module "cognito" {
  source = "./modules/cognito"

  project_name = var.project_name
  environment  = var.environment
  user_email   = var.cognito_user_email
  # Initial callback URLs - will be updated after ALB is created
  callback_urls = ["http://localhost:3002"]
  logout_urls   = ["http://localhost:3002"]
}

# Secrets Manager
module "secrets" {
  source = "./modules/secrets"

  project_name       = var.project_name
  environment        = var.environment
  binance_api_key    = var.binance_api_key
  binance_api_secret = var.binance_api_secret
}

# EC2 Compute
module "compute" {
  source = "./modules/compute"

  project_name         = var.project_name
  environment          = var.environment
  instance_type        = var.instance_type
  vpc_id               = module.networking.vpc_id
  public_subnet_ids    = module.networking.public_subnet_ids
  allowed_ips          = var.allowed_ips
  ssh_key_name         = var.ssh_key_name
  secrets_arn          = module.secrets.secrets_arn
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.client_id
  cognito_region       = var.aws_region
}
