# One Secrets Manager secret per environment variable. Values are written out of band
# (`aws secretsmanager put-secret-value`) so they never enter Terraform state.

resource "aws_secretsmanager_secret" "this" {
  for_each = toset(var.secret_names)

  name                    = "${var.name_prefix}/api/${each.key}"
  description             = "BI-Rem API ${each.key} (${var.name_prefix})"
  recovery_window_in_days = var.recovery_window_in_days
}

data "aws_iam_policy_document" "read" {
  statement {
    sid       = "ReadApiSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.this : s.arn]
  }
}

resource "aws_iam_policy" "read" {
  name   = "${var.name_prefix}-api-secrets-read"
  policy = data.aws_iam_policy_document.read.json
}
