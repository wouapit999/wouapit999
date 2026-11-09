variable "environment" {
  description = "Deployment environment name (staging | production)."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "aws_region" {
  description = "AWS region hosting the stack (eu-central-1 pairs with Neon aws-eu-central-1)."
  type        = string
  default     = "eu-central-1"
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread subnets across."
  type        = number
  default     = 2
}

variable "api_image" {
  description = "Fully qualified API image reference (digest pinned), e.g. <account>.dkr.ecr.<region>.amazonaws.com/bi-rem-api@sha256:..."
  type        = string
}

variable "api_container_port" {
  description = "Port the API listens on inside the container."
  type        = number
  default     = 4000
}

variable "api_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 1024
}

variable "api_min_tasks" {
  description = "Minimum number of running API tasks."
  type        = number
  default     = 2
}

variable "api_max_tasks" {
  description = "Maximum number of API tasks for autoscaling."
  type        = number
  default     = 10
}

variable "api_domain_name" {
  description = "Public hostname of the API (must be covered by acm_certificate_arn)."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate attached to the HTTPS listener."
  type        = string
}

variable "api_environment" {
  description = "Non-secret environment variables for the API task."
  type        = map(string)
  default = {
    NODE_ENV  = "production"
    API_PORT  = "4000"
    LOG_LEVEL = "info"
  }
}

variable "api_secret_names" {
  description = "Secret environment variable names created in Secrets Manager and injected into the task. Values are set out of band."
  type        = list(string)
  default = [
    "DATABASE_URL",
    "DIRECT_URL",
    "REDIS_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "ENCRYPTION_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "SENTRY_DSN",
  ]
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the API log group."
  type        = number
  default     = 30
}
