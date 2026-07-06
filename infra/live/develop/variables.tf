variable "acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener (ap-southeast-1)"
}

variable "web_acm_cert_arn" {
  type        = string
  description = "ACM certificate ARN for CloudFront (MUST be in us-east-1)"
}

variable "entra_tenant_id" {
  type        = string
  description = "Microsoft Entra (Azure AD) tenant ID — leave empty to disable SSO"
  default     = ""
}

variable "entra_client_id" {
  type        = string
  description = "Microsoft Entra (Azure AD) app client ID — leave empty to disable SSO"
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
