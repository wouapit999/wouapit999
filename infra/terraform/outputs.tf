output "alb_dns_name" {
  description = "Point the api_domain_name CNAME/alias at this hostname."
  value       = module.alb.dns_name
}

output "ecs_cluster_name" {
  value = module.api.cluster_name
}

output "ecs_service_name" {
  value = module.api.service_name
}

output "migration_task_definition_arn" {
  description = "Task definition to run with `aws ecs run-task` before each deploy."
  value       = module.api.migration_task_definition_arn
}

output "secret_arns" {
  description = "Secrets Manager ARNs keyed by environment variable name."
  value       = module.secrets.secret_arns
}
