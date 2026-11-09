variable "name" {
  description = "Name prefix for VPC resources."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR."
  type        = string
}

variable "availability_zone_count" {
  description = "How many AZs to use (public + private subnet per AZ)."
  type        = number
  default     = 2
}

variable "enable_nat_gateway" {
  description = "Create a NAT gateway for private subnets (disable when VPC endpoints cover all egress)."
  type        = bool
  default     = true
}
