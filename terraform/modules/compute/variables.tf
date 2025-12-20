variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs"
  type        = list(string)
}

variable "allowed_ips" {
  description = "List of allowed IPs for dashboard access"
  type        = list(string)
}

variable "ssh_key_name" {
  description = "Name of SSH key pair"
  type        = string
}

variable "secrets_arn" {
  description = "ARN of Secrets Manager secret"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito App Client ID"
  type        = string
}

variable "cognito_region" {
  description = "AWS region for Cognito"
  type        = string
}
