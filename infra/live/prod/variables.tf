variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the production ALB HTTPS listener (ap-southeast-1)"
}

# DEPRECATED: web now serves via Cloudflare Pages (no CloudFront ACM cert).
# Retained only so existing CI env (TF_VAR_web_acm_cert_arn) doesn't error;
# remove after the Pages migration is fully rolled out.
variable "web_acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for production CloudFront (MUST be in us-east-1)"
}

variable "cloudflare_account_id" {
  type        = string
  default     = ""
  description = "Cloudflare account ID that owns the Pages project (account-level input, not a secret). Pass via TF_VAR_cloudflare_account_id in CI."
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
