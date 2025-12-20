output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.main.id
}

output "instance_public_ip" {
  description = "Public IP of EC2 instance"
  value       = aws_eip.main.public_ip
}

output "instance_private_ip" {
  description = "Private IP of EC2 instance"
  value       = aws_instance.main.private_ip
}

output "alb_arn" {
  description = "ARN of Application Load Balancer"
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "DNS name of Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "security_group_id" {
  description = "Security group ID for EC2 instance"
  value       = aws_security_group.ec2.id
}
