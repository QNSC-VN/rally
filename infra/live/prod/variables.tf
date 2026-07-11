variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the production ALB HTTPS listener (ap-southeast-1)"
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "Container image tag to deploy for api & worker. CI overrides this with the release sha to pin prod images; defaults to 'latest' for a bare apply."
}

variable "prod_tier" {
  type        = string
  default     = "lean"
  description = <<-EOT
    Production reliability tier (Option A cost switch):
    'lean' (~$200/mo) = shared runtime-prod cache node + single-AZ RDS + 1 task/svc.
    'ha'   (~$300/mo) = per-product cache + multi-AZ RDS + 2 tasks/svc + Enhanced Monitoring.
    Only per-product knobs (RDS, cache, task counts) switch here; the shared
    VPC/NAT/ALB/WAF tier is selected in qnsc-infra/live/runtime-prod.
  EOT
  validation {
    condition     = contains(["lean", "ha"], var.prod_tier)
    error_message = "prod_tier must be 'lean' or 'ha'."
  }
}

variable "entra_tenant_id" {
  type        = string
  default     = ""
  description = "Microsoft Entra (Azure AD) tenant ID — required (BFF auth); injected via TF_VAR in CI"
}

variable "entra_client_id" {
  type        = string
  default     = ""
  description = "Microsoft Entra (Azure AD) app client ID — required (BFF auth); injected via TF_VAR in CI"
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
