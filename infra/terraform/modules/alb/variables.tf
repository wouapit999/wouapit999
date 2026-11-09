variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "acm_certificate_arn" {
  type = string
}

variable "target_port" {
  type    = number
  default = 4000
}

variable "health_check_path" {
  type    = string
  default = "/health/ready"
}
