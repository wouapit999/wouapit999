variable "name_prefix" {
  description = "Prefix for secret names, e.g. bi-rem-staging."
  type        = string
}

variable "secret_names" {
  description = "Environment variable names to create as individual secrets."
  type        = list(string)
}

variable "recovery_window_in_days" {
  description = "Days before a deleted secret is purged (0 = immediate, only for staging)."
  type        = number
  default     = 7
}
