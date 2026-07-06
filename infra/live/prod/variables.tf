variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the production ALB HTTPS listener (ap-southeast-1)"
}

variable "web_acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for production CloudFront (MUST be in us-east-1)"
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Cloudflare API token (Zone:DNS:Edit on qnsc.vn). Supplied via TF_VAR_cloudflare_api_token in CI. Zone ID is read from qnsc-infra bootstrap via _shared remote state, not an input."
}

variable "web_domain" {
  type        = string
  default     = ""
  description = <<-EOT
    Public hostname for the prod web SPA (e.g. "rally.qnsc.vn"). Leave empty
    until the prod domain is decided — CloudFront alias and the Cloudflare DNS
    record are both skipped while empty, so prod applies cleanly without it.
  EOT
}
