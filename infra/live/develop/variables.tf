




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

// ── Public identifiers, held in git on purpose ────────────────────────────────
// These are NOT secrets: an Entra tenant/client id appears in the browser's auth
// redirect, a GitHub App id is public, and a Cloudflare account id identifies the
// account without authorising anything. The corresponding SECRETS live in Secrets
// Manager (entra-client-secret, github-app-private-key) and the Cloudflare API
// token stays a GitHub secret.
//
// They used to arrive as TF_VARs from GitHub Actions variables, which made
// `infra-plan` lie: ENTRA_CLIENT_ID is environment-scoped, the plan job has no
// `environment:` context (adding one would gate every PR behind the production
// reviewer), so it resolved to "" and every plan reported three ECS task
// definitions "must be replaced". Reviewers who see phantom replacements on every
// PR stop reading plans — which is exactly when a real one slips through.
//
// In git the value is identical at plan and apply time, so the plan tells the truth
// and the value is reviewable in a diff.

variable "entra_tenant_id" {
  description = "Microsoft Entra tenant id (public)."
  type        = string
  default     = "dc0f2078-ac28-4ff2-b21a-d4b28df32361"
}

variable "entra_client_id" {
  description = "Entra application (client) id for this environment — a distinct app registration per environment."
  type        = string
  default     = "45fabceb-e51c-446b-894e-af4c4b7f30f8"
}

variable "github_app_id" {
  description = "GitHub App id for SCM discovery/backfill (public)."
  type        = string
  default     = "4390002"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the Pages project (public identifier)."
  type        = string
  default     = "69e52835cf2d08edde5b6ebd741d30fa"
}

variable "otlp_endpoint" {
  description = <<-EOT
    OTLP/HTTP base URL of the telemetry backend — qnsc-infra's live/observability
    stack, region prod-ap-southeast-0, with the `/otlp` suffix the otlphttp
    exporter needs (the stack's own `otlp_url` output omits it).

    Setting this creates the `observability-token` Secrets Manager secret (empty)
    and flips the sidecar on in the task definition — but the secret's VALUE must
    be populated by hand (Basic base64(stack_id:token), never through Terraform —
    see modules/stack/main.tf) and the service must be DEPLOYED before telemetry
    actually flows. Blank would keep telemetry dormant; this repo's stack is live,
    so blank is no longer the deliberate default.
  EOT
  type        = string
  default     = "https://otlp-gateway-prod-ap-southeast-0.grafana.net/otlp"
}
