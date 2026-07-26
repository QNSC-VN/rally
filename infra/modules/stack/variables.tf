// The product stack's input surface.
//
// Everything an environment CHOOSES is here; everything DERIVED from those choices
// lives in main.tf's locals. That split is the point of the module: develop and prod
// can no longer differ in structure, only in the values below, so a change made for
// one environment is automatically made for both.
//
// Defaults lean SAFE rather than cheap — a forgotten input should err toward
// production behaviour (no Spot, longer retention, deletion protection on), because
// the failure mode of a too-cheap production is worse than a too-careful develop.

// ── Identity ────────────────────────────────────────────────────────────────────

variable "product" {
  description = "Product slug. Drives resource names, ECR repos, secret prefixes and the metric namespace."
  type        = string
}

variable "env" {
  description = "Environment name as it appears in tags, secret prefixes and the metric namespace (e.g. develop, production)."
  type        = string
}

variable "env_slug" {
  description = <<-EOT
    Short environment token used in RESOURCE NAMES (`<product>-<env_slug>`).
    Deliberately separate from `env`: existing resources are named `rally-prod`
    while the environment is called `production`, and renaming them would force
    replacement of the cluster, RDS instance and log groups.
  EOT
  type        = string
}

variable "region" {
  type = string
}

// ── Networking / DNS ────────────────────────────────────────────────────────────

variable "app_domain" {
  description = "Public SPA hostname. Also drives CORS_ORIGINS, APP_BASE_URL and ENTRA_REDIRECT_URI."
  type        = string
}

variable "api_domain" {
  description = "Public API hostname, used for the ALB host-header rule and the SPA proxy's API_ORIGIN."
  type        = string
}

variable "web_record" {
  description = "Cloudflare CNAME label for the SPA (e.g. `rally-dev`, `rally`)."
  type        = string
}

variable "api_record" {
  description = "Cloudflare CNAME label for the API (e.g. `rally-api-dev`, `rally-api`)."
  type        = string
}

// ── Remote state ────────────────────────────────────────────────────────────────

variable "shared_state_key" {
  description = "State key of the product's _shared stack (ECR, KMS, Cloudflare zone)."
  type        = string
}

variable "runtime_state_key" {
  description = "State key of the platform runtime stack for this environment (VPC, ALB, SGs)."
  type        = string
}

variable "storage_state_key" {
  description = "State key of the platform storage stack for this environment (R2 buckets)."
  type        = string
}

// ── Application ─────────────────────────────────────────────────────────────────

variable "image_tag" {
  description = "Container image tag for api/worker/migrator. `latest` is acceptable in develop; production should pin a release tag."
  type        = string
  default     = "latest"
}

variable "redis_url" {
  description = <<-EOT
    Cache connection URL, supplied by the caller.

    The cache itself is NOT in this module yet: develop runs an inline
    ElastiCache node without encryption while production uses the shared `cache`
    module with KMS + TLS (`rediss://`). Unifying them replaces the develop node
    and changes the connection scheme, so it is a deliberate follow-up rather
    than part of a structural refactor.
  EOT
  type        = string
}

variable "platform_admin_emails" {
  description = "Emails auto-granted workspace_admin on every SSO login."
  type        = list(string)
  default     = []
}

variable "seed_on_deploy" {
  description = "Whether the migrator runs the demo seed after migrating. Never true in production."
  type        = bool
  default     = false
}

variable "entra_tenant_id" {
  type = string
}

variable "entra_client_id" {
  type = string
}

variable "github_app_id" {
  description = "GitHub App ID for SCM discovery/backfill. Empty keeps the SCM path dormant."
  type        = string
  default     = ""
}

// ── Per-environment tuning ──────────────────────────────────────────────────────

variable "log_retention_days" {
  description = "CloudWatch log retention for api, worker and migrator. Production keeps 90 for SOC 2."
  type        = number
  default     = 90
}

variable "secrets_recovery_window_days" {
  description = <<-EOT
    Secrets Manager recovery window. 0 in develop so a destroy+redeploy cycle does
    not hit "secret scheduled for deletion"; production keeps a real window so a
    mistaken destroy is recoverable.
  EOT
  type        = number
  default     = 30
}

variable "dlq_max_receive_count" {
  description = "Deliveries before a message moves to the DLQ."
  type        = number
  default     = 5
}

variable "rds" {
  description = "Database sizing and durability. No defaults for storage or protection — both callers state them explicitly, so neither is production-critical by accident."
  type = object({
    instance_class           = string
    allocated_storage_gb     = number
    max_allocated_storage_gb = number
    multi_az                 = bool
    deletion_protection      = bool
    backup_retention_days    = number
    monitoring_interval      = optional(number, 0)
  })
}

variable "api" {
  description = "API service sizing and scaling."
  type = object({
    cpu               = number
    memory            = number
    max_count         = number
    use_spot          = optional(bool, false)
    cpu_target_pct    = optional(number, null)
    memory_target_pct = optional(number, null)
  })
}

variable "worker" {
  description = "Worker service sizing and scaling."
  type = object({
    cpu       = number
    memory    = number
    max_count = number
    use_spot  = optional(bool, false)
  })
}

variable "alarm_emails" {
  description = "Addresses subscribed to the alarm topic. Terraform creates the subscription; each recipient must still confirm by email."
  type        = list(string)
  default     = []
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the Pages project."
  type        = string
  default     = ""
}

