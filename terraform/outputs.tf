output "instance_public_ip" {
  description = "Public IP of the EC2 instance"
  value       = module.compute.instance_public_ip
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.compute.alb_dns_name
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_client_id" {
  description = "Cognito App Client ID"
  value       = module.cognito.client_id
  sensitive   = true
}

output "cognito_domain" {
  description = "Cognito hosted UI domain"
  value       = module.cognito.domain
}

output "dashboard_url" {
  description = "URL to access the trading dashboard"
  value       = "https://${module.compute.alb_dns_name}"
}

output "ecr_repository_url" {
  description = "ECR repository URL for Docker images"
  value       = module.ecr.repository_url
}

output "ecr_repository_name" {
  description = "ECR repository name"
  value       = module.ecr.repository_name
}
