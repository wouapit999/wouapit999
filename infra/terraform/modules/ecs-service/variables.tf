variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "target_group_arn" {
  type = string
}

variable "container_image" {
  type = string
}

variable "container_port" {
  type    = number
  default = 4000
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "min_tasks" {
  type    = number
  default = 2
}

variable "max_tasks" {
  type    = number
  default = 10
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "secret_arns" {
  description = "Map of env var name to Secrets Manager ARN injected as ECS secrets."
  type        = map(string)
  default     = {}
}

variable "secrets_read_policy" {
  description = "IAM policy ARN granting GetSecretValue on the secrets above."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "migration_command" {
  description = "Command override for the one-off migration task (entrypoint subcommand)."
  type        = list(string)
  default     = ["migrate"]
}
