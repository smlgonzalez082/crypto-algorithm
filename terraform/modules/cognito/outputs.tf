output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "client_id" {
  description = "Cognito App Client ID"
  value       = aws_cognito_user_pool_client.main.id
}

output "domain" {
  description = "Cognito hosted UI domain"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "admin_username" {
  description = "Admin username"
  value       = aws_cognito_user.admin.username
}

output "admin_temp_password" {
  description = "Temporary password for admin user (change on first login)"
  value       = random_password.admin_temp_password.result
  sensitive   = true
}
