provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "bi-rem"
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "github.com/wouapit999/wouapit999"
    }
  }
}
