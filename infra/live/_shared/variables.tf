variable "github_org" {
  type        = string
  description = "GitHub organisation or username that owns rally-api, rally-web, rally-infra repos"
  default     = "QNSC-VN"
}

variable "mail_domain" {
  description = <<-EOT
    The domain SES verifies for outbound mail — the domain half of every environment's
    `mail_from_email`. One identity covers both environments because they share the account and
    region, which is why it is declared here and not per env.
  EOT
  type        = string
  default     = "qnsc.vn"
}

variable "cloudflare_api_token" {
  description = "Cloudflare token for the SES DKIM records. Supplied by CI (CLOUDFLARE_API_TOKEN); empty falls back to the provider's own environment lookup."
  type        = string
  default     = ""
  sensitive   = true
}

variable "mail_region" {
  description = <<-EOT
    The region whose SES sends the mail. Only used to build the custom MAIL FROM MX host
    (`feedback-smtp.<region>.amazonses.com`), which is region-specific — a wrong value silently loses
    bounce notifications rather than failing loudly.
  EOT
  type        = string
  default     = "ap-southeast-1"
}
