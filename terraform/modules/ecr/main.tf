# Reference existing ECR repository created by GitHub Actions workflow
# The workflow creates this before Terraform runs
data "aws_ecr_repository" "app" {
  name = "${var.project_name}-${var.environment}"
}

# Lifecycle policy to keep only the last N images
resource "aws_ecr_lifecycle_policy" "app" {
  repository = data.aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
