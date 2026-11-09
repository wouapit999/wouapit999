# Root module: wires the building blocks together. Each module is a skeleton with the
# resources that define the shape of the stack; harden and extend per environment.

locals {
  name_prefix = "bi-rem-${var.environment}"
}

module "vpc" {
  source = "./modules/vpc"

  name                    = local.name_prefix
  cidr_block              = var.vpc_cidr
  availability_zone_count = var.availability_zone_count
}

module "secrets" {
  source = "./modules/secrets"

  name_prefix  = local.name_prefix
  secret_names = var.api_secret_names
}

module "alb" {
  source = "./modules/alb"

  name                = local.name_prefix
  vpc_id              = module.vpc.vpc_id
  public_subnet_ids   = module.vpc.public_subnet_ids
  acm_certificate_arn = var.acm_certificate_arn
  target_port         = var.api_container_port
  health_check_path   = "/health/ready"
}

module "api" {
  source = "./modules/ecs-service"

  name                  = local.name_prefix
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arn
  container_image       = var.api_image
  container_port        = var.api_container_port
  cpu                   = var.api_cpu
  memory                = var.api_memory
  min_tasks             = var.api_min_tasks
  max_tasks             = var.api_max_tasks
  environment_variables = var.api_environment
  secret_arns           = module.secrets.secret_arns
  secrets_read_policy   = module.secrets.read_policy_arn
  log_retention_days    = var.log_retention_days
  migration_command     = ["migrate"]
}
