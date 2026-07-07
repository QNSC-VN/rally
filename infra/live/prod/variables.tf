variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the production ALB HTTPS listener (ap-southeast-1)"
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

# Empty-string is treated as "unset" (an unset GitHub Actions `vars.*` renders as
# ""), falling back to the saas default. This keeps prod applying cleanly when
# the repo variables aren't configured.
variable "deployment_mode" {
  type    = string
  default = ""
  validation {
    condition     = contains(["", "saas", "single"], var.deployment_mode)
    error_message = "deployment_mode must be 'saas' or 'single'."
  }
  description = <<-EOT
    'saas'   = one deployment serves many tenants; self-serve signup on. (default)
    'single' = packaged for one customer; exactly one tenant, signup off, SSO
               maps the customer IdP to that tenant. Set per customer deploy.
    When 'single', also set single_tenant_name / single_tenant_slug.
  EOT
}

variable "single_tenant_name" {
  type        = string
  default     = ""
  description = "single mode only: display name of the one tenant."
}

variable "single_tenant_slug" {
  type        = string
  default     = ""
  description = "single mode only: url-safe slug of the one tenant."
}
