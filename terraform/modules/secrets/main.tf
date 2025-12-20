resource "aws_secretsmanager_secret" "binance_credentials" {
  name        = "${var.project_name}-${var.environment}-binance-credentials"
  description = "Binance API credentials for trading bot"

  recovery_window_in_days = 7

  tags = {
    Name = "${var.project_name}-${var.environment}-binance"
  }
}

resource "aws_secretsmanager_secret_version" "binance_credentials" {
  secret_id = aws_secretsmanager_secret.binance_credentials.id

  secret_string = jsonencode({
    api_key    = var.binance_api_key
    api_secret = var.binance_api_secret
  })
}
