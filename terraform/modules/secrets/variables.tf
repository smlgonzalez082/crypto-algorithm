variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment"
  type        = string
}

variable "binance_api_key" {
  description = "Binance API key"
  type        = string
  sensitive   = true
}

variable "binance_api_secret" {
  description = "Binance API secret"
  type        = string
  sensitive   = true
}
