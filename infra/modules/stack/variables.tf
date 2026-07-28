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

variable "cache" {
  description = <<-EOT
    Cache sizing. Encryption is NOT an option here: the module always enables
    KMS at rest and TLS in transit, so both environments get the same posture and
    the URL is always `rediss://`.

    `serverless` mode floors at roughly $90/month, so `node` is the default for
    both environments; a single cache.t4g.micro is about $12/month.
  EOT
  type = object({
    mode      = optional(string, "node")
    node_type = optional(string, "cache.t4g.micro")
  })
  default = {}
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

variable "observability" {
  description = <<-EOT
    Telemetry export. `otlp_endpoint` is the master switch: while it is empty no
    collector sidecar is created, `OTEL_ENABLED` stays false, and the whole OTel
    path is dormant — so this can be adopted before a backend exists.

    Turning it on is two steps, in this order:
      1. put the Authorization header in the `observability-token` secret
      2. set `otlp_endpoint` here
    Reversing them starts a collector that cannot authenticate.

    `sampling_probability` is HEAD sampling, the only lever the SDK has alone.
    1.0 in develop (volume is trivial and full fidelity is the point of enabling it
    there); lower in production for cost. Be aware that anything below 1.0 drops
    most ERROR traces too — keeping all errors needs tail sampling, which needs a
    gateway that sees whole traces, not a per-task sidecar.
  EOT
  type = object({
    otlp_endpoint        = optional(string, "")
    sampling_probability = optional(number, 1.0)
  })
  default = {}
}

variable "monitor_target_health" {
  description = <<-EOT
    Create the per-service UnHealthyHostCount alarm.

    OFF in develop on purpose. The alarm treats missing data as breaching, because a
    target group with no registered targets publishes nothing at all and that is exactly
    the outage worth paging on. But develop has an off-hours cost-saver that scales
    services to 0 (qnsc-ci's deploy reusable restores them), so zero tasks is a NORMAL
    state there and the alarm would sit permanently in ALARM — noise that trains people
    to ignore the topic every other alarm publishes to.
  EOT
  type        = bool
  default     = true
}

variable "container_insights" {
  description = <<-EOT
    ECS Container Insights mode: "enhanced", "enabled" or "disabled".

    Stated here rather than inherited, because the ecs-cluster module defaults to
    "enhanced" and that default is expensive: enhanced adds per-task and per-container
    metrics that CloudWatch bills as CUSTOM metrics at $0.07 each. Four clusters
    silently on that default produced 606 metric-months (~$42) on the July 2026 bill,
    and the count grows with task churn rather than with traffic.

    Defaults to "disabled" because an audit of every consumer found none: all 7 alarms
    and all 6 dashboard widgets read AWS/ECS, AWS/ApplicationELB and AWS/RDS, which are
    free and published regardless, and application metrics go to the OTLP backend rather
    than CloudWatch. Both environments state "disabled" explicitly; this default exists
    so a NEW environment does not start paying for metrics nothing queries.

    Raise an environment to "enhanced" while debugging a per-container resource problem,
    then put it back.
  EOT
  type        = string
  default     = "disabled"

  validation {
    condition     = contains(["enhanced", "enabled", "disabled"], var.container_insights)
    error_message = "container_insights must be enhanced, enabled, or disabled."
  }
}

variable "create_dashboard" {
  description = <<-EOT
    Create the CloudWatch dashboard for this environment. Alarms are created either way.

    CloudWatch bills dashboards per ACCOUNT: three free, then $3/mo each. Two products
    at two environments is four, so the fourth starts charging. Develop is the one to
    drop — alarms are what page someone, a dashboard is what you open afterwards, and
    nobody opens develop's.
  EOT
  type        = bool
  default     = true
}

variable "fargate_architecture" {
  description = <<-EOT
    CPU architecture for every Fargate task in this stack: "ARM64" or "X86_64".

    ARM64 (Graviton) bills roughly 20% less per vCPU-hour and GB-hour for identical
    sizing, and rally has no native dependency that cares — `argon2` was the only one
    in package.json and nothing imported it.

    Deliberately NOT per-environment. Production runs the image develop tested,
    promoted by tag without a rebuild, so the two cannot differ in architecture even in
    principle. It must also match `image_platforms` in
    .github/workflows/backend-deploy.yml: an x86 image on an ARM64 task fails at
    container start with "image Manifest does not contain descriptor matching platform".
  EOT
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.fargate_architecture)
    error_message = "fargate_architecture must be ARM64 or X86_64."
  }
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

