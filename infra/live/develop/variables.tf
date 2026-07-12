variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener (ap-southeast-1)"
}

variable "cloudflare_account_id" {
  type        = string
  default     = ""
  description = <<-EOT
    Cloudflare account ID that owns the Pages project (account-level input, not
    a secret). Pass via TF_VAR_cloudflare_account_id in CI. Leave empty to skip
    the web module while the Cloudflare account is not yet wired.
  EOT
}


variable "entra_tenant_id" {
  type        = string
  description = "Microsoft Entra (Azure AD) tenant ID — required (BFF auth); injected via TF_VAR in CI"
  default     = ""
}

variable "entra_client_id" {
  type        = string
  description = "Microsoft Entra (Azure AD) app client ID — required (BFF auth); injected via TF_VAR in CI"
  default     = ""
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = <<-EOT
    Cloudflare API token (Zone:DNS:Edit on qnsc.vn). Supplied via
    TF_VAR_cloudflare_api_token in CI. Leave empty to skip Cloudflare provider
    auth. The zone ID itself is NOT an input here — it's read from qnsc-infra
    bootstrap via _shared remote state (one source of truth, like kms_key_arn).
  EOT
}
