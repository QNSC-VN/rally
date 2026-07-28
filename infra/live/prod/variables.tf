variable "image_tag" {
  type        = string
  default     = "latest"
  description = "Container image tag to deploy for api & worker. CI overrides this with the release sha to pin prod images; defaults to 'latest' for a bare apply."
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
  default     = "503133fe-58c0-4158-86ca-0cecb2f6f376"
}

variable "github_app_id" {
  # Production has its OWN App registration, separate from develop's 4390002, so a
  # develop misconfiguration cannot touch production's installation or its webhooks.
  #
  # This was empty while no App existed, which left the SCM path dormant — correct at
  # the time. It stayed empty after the App was registered, so production shipped with
  # GITHUB_APP_ID="" on the running task definition: no PR/commit linking, no backfill,
  # and the webhook receiver answering 503. The id lived only in a GitHub environment
  # variable that nothing reads.
  #
  # Held in git, not in an Actions variable, for the reason in .github/workflows/
  # infra-plan.yml: an environment-scoped variable is invisible to a plan job, which
  # made every plan report three phantom task-definition replacements.
  description = "GitHub App id for SCM discovery/backfill (public)."
  type        = string
  default     = "4398910"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the Pages project (public identifier)."
  type        = string
  default     = "69e52835cf2d08edde5b6ebd741d30fa"
}

variable "otlp_endpoint" {
  description = <<-EOT
    OTLP/HTTP base URL of the telemetry backend, e.g.
    `https://otlp-gateway-prod-ap-southeast-1.grafana.net/otlp`.

    Empty (the default) keeps telemetry DORMANT: no collector sidecar is created
    and OTEL_ENABLED stays false. Populate the `observability-token` secret with
    the Authorization header BEFORE setting this, or the collector starts and
    cannot authenticate.
  EOT
  type        = string
  default     = ""
}
