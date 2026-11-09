terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Remote state. Pass the bucket/table with -backend-config=environments/<env>.backend.hcl
  # so the same code serves staging and production from separate state files.
  backend "s3" {}
}
