variable "image_tag" {
  type        = string
  default     = "latest"
  description = "Container image tag to deploy for api & worker. CI overrides this with the release sha to pin prod images; defaults to 'latest' for a bare apply."
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

variable "github_app_id" {
  type        = string
  default     = ""
  description = <<-EOT
    GitHub App ID for the SCM Connections backfill (non-secret). Injected via
    TF_VAR_github_app_id in CI. Leave empty until the "Rally SCM" GitHub App is
    registered — an empty value keeps backfill dormant (isConfigured() = false)
    and the stack still applies cleanly. The App private key + webhook secret are
    NOT here — they live in Secrets Manager (github-app-private-key,
    github-webhook-secret).
  EOT
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Cloudflare API token (Zone:DNS:Edit on qnsc.vn). Supplied via TF_VAR_cloudflare_api_token in CI. Zone ID is read from qnsc-infra bootstrap via _shared remote state, not an input."
}

variable "alarm_emails" {
  description = <<-EOT
    Addresses subscribed to the alarm topic. Terraform creates the subscription;
    each recipient must still click the confirmation link AWS emails them, so a
    freshly-added address receives nothing until it does.
  EOT
  type        = list(string)
  default     = ["nghiavt@qnsc.vn"]
}

variable "platform_admin_emails" {
  description = <<-EOT
    Emails auto-granted workspace_admin on every SSO login. A variable rather than a
    literal in the stack so the two environments can differ (and so adding a
    colleague is a values change, not a module change).
  EOT
  type        = list(string)
  default     = ["nghiavt@qnsc.vn", "quangld@qnsc.vn", "hieuvbm@qnsc.vn", "anhntn@qnsc.vn"]
}
