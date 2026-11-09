output "secret_arns" {
  description = "Map of environment variable name to secret ARN."
  value       = { for name, s in aws_secretsmanager_secret.this : name => s.arn }
}

output "read_policy_arn" {
  description = "IAM policy granting GetSecretValue on all API secrets (attach to the task execution role)."
  value       = aws_iam_policy.read.arn
}
