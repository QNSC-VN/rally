data "aws_caller_identity" "current" {}

# ── Read shared layer outputs (ECR URLs, KMS ARN, artifacts bucket) ───────────
# _shared owns ECR repos and re-exports platform-level outputs from qnsc-infra.
# Dependency: the product's _shared stack must be applied before this one.
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = var.shared_state_key
    region = "ap-southeast-1"
  }
}

locals {
  # Values that are DERIVED, not chosen. Anything an environment picks is a
  # variable; anything computed from those lives here, so the two callers cannot
  # drift in how a value is assembled — only in what they feed in.
  name         = "${var.product}-${var.env_slug}"
  app_base_url = "https://${var.app_domain}"

  kms_key_arn        = data.terraform_remote_state.shared.outputs.kms_key_arn
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")
  cloudflare_ipv4    = data.terraform_remote_state.shared.outputs.cloudflare_ipv4

  # `rediss://`, never `redis://`: the cache module enables transit encryption
  # unconditionally, so a plaintext scheme would simply fail to connect.
  redis_url = "rediss://${module.cache.endpoint}:${module.cache.port}"

  # Computed, not read from `module.api.log_group_name`, to break a dependency
  # cycle: the agent needs a log group, the api needs the agent's container
  # definition, and the api is what creates the log group. `ecs-service` names it
  # `/ecs/<cluster>-<service>` deterministically, and the `check` blocks at the
  # bottom of this file fail the plan if that convention ever changes.
  api_log_group    = "/ecs/${local.name}-api"
  worker_log_group = "/ecs/${local.name}-worker"

  # Telemetry env shared by api and worker. Both must agree, or the two halves of
  # one trace land under different environments or sampling ratios.
  otel_env = [
    # DEPLOYMENT_ENV, not NODE_ENV. NODE_ENV is pinned to "production" in DEVELOP
    # too (see the env-flag notes in CLAUDE.md), so deriving deployment identity
    # from it labelled every develop span, metric and log as production.
    { name = "DEPLOYMENT_ENV", value = var.env },
    # Terraform already knows the deployed tag, so `service.version` needs no CI
    # plumbing. Prod pins a release tag; develop is honestly "latest".
    { name = "SERVICE_VERSION", value = var.image_tag },
    { name = "OTEL_SAMPLING_PROBABILITY", value = tostring(var.observability.sampling_probability) },
  ]

  # Collector footprint, scaled to the task it rides in. A sidecar's container-level
  # `memory` is a HARD limit carved out of the TASK's total, not additional capacity, so
  # the module's 128 CPU / 256 MiB default is half of develop's 256/512 worker task —
  # enough to OOM a NestJS process the moment telemetry is switched on. Cap the collector
  # at an eighth of task memory with a 128 MiB floor, and keep the soft memory_limiter
  # threshold at the module's 62.5% ratio so it sheds telemetry before it is killed.
  otel_api_memory    = max(128, min(256, floor(var.api.memory / 8)))
  otel_worker_memory = max(128, min(256, floor(var.worker.memory / 8)))
  otel_api_cpu       = max(64, min(128, floor(var.api.cpu / 8)))
  otel_worker_cpu    = max(64, min(128, floor(var.worker.cpu / 8)))

  ecr_base         = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
  ecr_api_url      = "${local.ecr_base}/${var.product}-api:${var.image_tag}"
  ecr_worker_url   = "${local.ecr_base}/${var.product}-worker:${var.image_tag}"
  ecr_migrator_url = "${local.ecr_base}/${var.product}-migrator:${var.image_tag}"

  tags = { Environment = var.env }
}

# ── Shared runtime layer (VPC + NAT + ALB) ────────────────────────────────────
# Option A: the VPC/NAT/ALB now live once per env in qnsc-infra/live/runtime-dev
# and are shared by every product. This stack consumes them via remote state
# instead of creating its own. RDS + Fargate stay per-product below.
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = var.runtime_state_key
    region = "ap-southeast-1"
  }
}

# ── Object storage layer (Cloudflare R2 attachment bucket) ────────────────
# The attachments bucket lives in the platform storage-dev stack (v5 Cloudflare
# provider, isolated from this v4 stack). We consume its name + S3-compatible
# endpoint via remote state — no Cloudflare provider or R2 resource here. The
# bucket-scoped runtime credentials come from Secrets Manager (r2-* below).
# Dependency: platform/storage-dev must be applied before this environment stack.
data "terraform_remote_state" "storage" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = var.storage_state_key
    region = "ap-southeast-1"
  }
}

# ── Secrets (scaffolding only — fill values in Secrets Manager console) ───────
module "secrets" {
  source      = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.1.0"
  prefix      = "${var.product}/${var.env}"
  kms_key_arn = local.kms_key_arn

  # Dev: delete secrets immediately on teardown (no 7-day recovery window) so a
  # destroy+redeploy cycle doesn't hit "secret scheduled for deletion" on the
  # recreate. Prod keeps the default recovery window for safety.
  recovery_window_days = var.secrets_recovery_window_days

  # ONE store: AWS Secrets Manager. The only other Secrets Manager secrets on the
  # account are the `rds!db-*` credentials RDS creates and rotates itself.
  #
  # Parameter Store SecureString would be free where this is $0.40 per secret per
  # month, and that was tried — but at 22 secrets it is $8.80/mo, 1.2% of the bill, and
  # Secrets Manager buys something Parameter Store cannot: a secret can exist while
  # holding NO value. That empty state is what makes "unpopulated" unambiguous and
  # gives the failure mode this stack wants everywhere — a task that cannot boot, a
  # failed deploy and a rollback, rather than a silent downgrade. Parameter Store
  # rejects an empty value, so the same guarantee needed a placeholder, a version-number
  # check in CI, and a runtime guard: three mechanisms replacing one property, plus a
  # new failure mode (a value that looks set and is not).
  #
  # Revisit past roughly 30 secrets, where the per-secret fee starts to outweigh that.
  # The `secure_parameters` input on this module supports the switch when it does.
  #
  # Terraform creates these EMPTY; values are pasted in out of band and never enter
  # state. The deploy preflight in qnsc-ci refuses to deploy while any injected secret
  # is still an empty container.
  secret_names = {
    # There is deliberately NO jwt-public here. `env.schema.ts` derives the public key
    # from this one, because an ES256 public key is a pure function of its private half and
    # rally publishes no JWKS. Storing both allowed the one failure a key pair cannot
    # otherwise have — a mismatched pair, where signing succeeds and every verification
    # rejects — which nothing detected, since both halves were individually valid to
    # Terraform, to the deploy preflight and to the schema. Do not add it back.
    "jwt-private" = "EC P-256 (ES256) private key (PEM, base64-encoded)"
    "csrf-secret" = "CSRF token signing secret"
    # NOTE: give this a value BEFORE the next app deploy — COOKIE_SECRET is required at
    # startup, so a task wired to an empty secret cannot boot (a failed deploy plus
    # rollback, not a silent downgrade, which is the intent).
    "cookie-secret"       = "Cookie signing secret (distinct from csrf-secret)"
    "entra-client-secret" = "Microsoft Entra confidential-client secret (BFF OIDC)"
    # SCM (GitHub App) — minted in GitHub, pasted by hand (Terraform only scaffolds
    # empty containers). Both stay empty until the App is registered, which keeps the
    # SCM backfill and webhook paths dormant.
    "github-webhook-secret"  = "GitHub App webhook HMAC secret (X-Hub-Signature-256)"
    "github-app-private-key" = "GitHub App private key (PEM)"
    # MUST be scoped to BOTH R2 buckets (<product>-<env>-attachments AND
    # <product>-<env>-public-assets). StorageService uses one S3 client for both, so a
    # token scoped to attachments alone makes every avatar/logo write 403. R2 tokens are
    # minted by hand in the Cloudflare dashboard — re-mint with both buckets selected
    # when adding a bucket.
    #
    # The access key ID is an identifier rather than a credential (useless without the
    # secret half, and Cloudflare shows it in the dashboard), so it is the one value
    # here that could live in Parameter Store as a plain String. It does not, because
    # that module input takes the VALUE in Terraform — which would put it in state to
    # save $0.40/mo. Kept alongside its secret half instead.
    "r2-access-key-id"     = "Cloudflare R2 access key ID (attachments + public-assets)"
    "r2-secret-access-key" = "Cloudflare R2 secret access key (attachments + public-assets)"
    # PUBLIC-bucket-only credential. Optional: while empty, StorageService reuses the
    # pair above and behaviour is unchanged, so this can be adopted without a flag day.
    #
    # The point is blast radius. One token covering both buckets means a leak exposes
    # every permission-gated attachment AND lets an attacker overwrite avatars and logos.
    # Scope this one to <product>-<env>-public-assets only, set it, deploy, THEN re-mint
    # the pair above scoped to attachments alone — in that order, or public writes 403
    # between the two steps.
    "r2-public-access-key-id"     = "Cloudflare R2 access key ID (public-assets ONLY)"
    "r2-public-secret-access-key" = "Cloudflare R2 secret access key (public-assets ONLY)"
    # The COMPLETE Authorization header the collector sidecar sends upstream, e.g.
    # `Basic base64(instanceID:token)` — not the bare token. Assembling it in Terraform
    # would put the instance id in state and the credential in the collector's plaintext
    # config. Empty keeps the whole OTel path dormant.
    "observability-token" = "Authorization header for the OTLP backend (e.g. 'Basic <base64>')"
    # Passwords for the least-privilege database roles created by migration 0068
    # (rally_app / rally_worker). Empty containers only: the value is set by hand
    # at the same moment the role is granted LOGIN, so the password exists in
    # exactly two places — Secrets Manager and pg_authid — and never in state.
    #
    # Creating these changes nothing on its own. The api/worker tasks keep using
    # the RDS master credential until `db_least_privilege` flips to true, which is
    # a separate, per-environment apply. Order matters and is not enforceable in
    # Terraform: grant LOGIN and set the value FIRST, flip the flag second, or the
    # task boots and dies on 28P01. Full sequence in
    # docs/runbooks/db-role-least-privilege.md.
    "db-app-password"    = "Password for the rally_app Postgres role (api) — set with the LOGIN grant"
    "db-worker-password" = "Password for the rally_worker Postgres role (worker) — set with the LOGIN grant"
  }

  tags = local.tags
}

# ── RDS PostgreSQL 17 ─────────────────────────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v2.0.0"

  identifier        = local.name
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = var.rds.instance_class
  allocated_storage_gb     = var.rds.allocated_storage_gb
  max_allocated_storage_gb = var.rds.max_allocated_storage_gb
  multi_az                 = var.rds.multi_az
  deletion_protection      = var.rds.deletion_protection
  backup_retention_days    = var.rds.backup_retention_days
  monitoring_interval      = var.rds.monitoring_interval

  tags = local.tags
}

# ── Cache (Valkey/Redis) ──────────────────────────────────────────────────────
# Sessions live ONLY here, so this sits outside the ECS tasks and survives task
# replacement — that is what stops every deploy logging users out.
#
# `node` mode is an aws_elasticache_replication_group with at-rest KMS encryption
# and transit encryption both on, which is why the URL scheme below is `rediss://`.
# ioredis turns TLS on from that scheme alone (verified: `rediss://` yields
# `options.tls === true`), so no client-side configuration is needed.
module "cache" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = "${local.name}-cache"
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_cache_id
  kms_key_arn       = local.kms_key_arn

  mode      = var.cache.mode
  node_type = var.cache.node_type

  tags = local.tags
}

# ── Telemetry collector sidecars ──────────────────────────────────────────────
# One per service: each needs its own log group, and a sidecar can only ever see
# the task it lives in.
#
# Both are a NO-OP until `observability.otlp_endpoint` is set AND the
# `observability-token` secret holds a value — the module returns empty lists, and
# `OTEL_ENABLED` below is gated on the same flag, so the app is never told to
# export into a void. That is what makes turning telemetry on a one-line change
# per environment rather than a migration.
module "otel_agent_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/observability-agent?ref=observability-agent-v1.0.0"

  product          = var.product
  env              = var.env
  otlp_endpoint    = var.observability.otlp_endpoint
  token_secret_arn = module.secrets.secret_arns["observability-token"]
  log_group        = local.api_log_group
  region           = var.region

  cpu              = local.otel_api_cpu
  memory           = local.otel_api_memory
  memory_limit_mib = floor(local.otel_api_memory * 0.625)
}

module "otel_agent_worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/observability-agent?ref=observability-agent-v1.0.0"

  product          = var.product
  env              = var.env
  otlp_endpoint    = var.observability.otlp_endpoint
  token_secret_arn = module.secrets.secret_arns["observability-token"]
  log_group        = local.worker_log_group
  region           = var.region

  cpu              = local.otel_worker_cpu
  memory           = local.otel_worker_memory
  memory_limit_mib = floor(local.otel_worker_memory * 0.625)
}

# ── Messaging (SQS + SNS) ─────────────────────────────────────────────────────
module "messaging" {
  source                = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/messaging?ref=messaging-v1.0.0"
  prefix                = local.name
  dlq_max_receive_count = var.dlq_max_receive_count

  queues = {
    notifications = {}
    audit         = { visibility_timeout = 60 }
    reporting     = { visibility_timeout = 300 }
    search        = {}
  }

  topics = ["domain-events"]

  subscriptions = [
    {
      topic         = "domain-events"
      queue         = "notifications"
      filter_policy = jsonencode({ eventType = ["notification.created", "notification.updated"] })
    }
  ]

  tags = local.tags
}

# ── ALB ───────────────────────────────────────────────────────────────────────
# The ALB is shared and lives in runtime-dev. module.api attaches a host-header
# listener rule (var.api_domain, priority 100) to its HTTPS listener.

# ── ECS Cluster ───────────────────────────────────────────────────────────────
module "ecs_cluster" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-cluster?ref=ecs-cluster-v1.0.0"
  name   = local.name
  tags   = local.tags

  # Always stated, never inherited: the module default is "enhanced", whose per-task
  # metrics are billed as custom CloudWatch metrics. See the variable.
  container_insights = var.container_insights
}

# ── Database credentials — master vs least-privilege ──────────────────────────
# Today api, worker AND migrator all connect as the RDS master, which owns every
# table: an ordinary HTTP request runs with rights to DROP the schema it reads,
# and any row-level policy would be skipped, because Postgres exempts a table's
# owner from RLS unless FORCE ROW LEVEL SECURITY is also set. That exemption is
# what made the RLS layer in migration 0005 inert, and it is the audit's top
# finding in the drop-multi-tenant design doc.
#
# Migration 0068 creates rally_app / rally_worker with DML rights only. Flipping
# `db_least_privilege` per environment points the two runtime tasks at them. The
# MIGRATOR deliberately stays on master — it needs DDL, and narrowing it means
# transferring schema ownership, which is a separate and more disruptive step.
#
# Both branches keep the same shape the RDS-managed secret established: nothing
# is a hand-maintained copy, and the app composes the URL from parts. The only
# difference is that the username stops being a secret field — `rally_app` is not
# a credential — so it moves to plain env alongside host/port/name.
locals {
  api_db_secrets = var.db_least_privilege ? [
    { name = "DATABASE_PASSWORD", secret_arn = module.secrets.secret_arns["db-app-password"] },
    ] : [
    { name = "DATABASE_USER", secret_arn = "${module.rds.master_secret_arn}:username::" },
    { name = "DATABASE_PASSWORD", secret_arn = "${module.rds.master_secret_arn}:password::" },
  ]

  worker_db_secrets = var.db_least_privilege ? [
    { name = "DATABASE_PASSWORD", secret_arn = module.secrets.secret_arns["db-worker-password"] },
    ] : [
    { name = "DATABASE_USER", secret_arn = "${module.rds.master_secret_arn}:username::" },
    { name = "DATABASE_PASSWORD", secret_arn = "${module.rds.master_secret_arn}:password::" },
  ]

  api_db_env    = var.db_least_privilege ? [{ name = "DATABASE_USER", value = "rally_app" }] : []
  worker_db_env = var.db_least_privilege ? [{ name = "DATABASE_USER", value = "rally_worker" }] : []
}

# ── ECS Service — API ─────────────────────────────────────────────────────────
module "api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v2.0.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = var.region
  image_uri    = local.ecr_api_url

  cpu    = var.api.cpu
  memory = var.api.memory

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = var.api.max_count
  use_spot           = var.api.use_spot
  log_retention_days = var.log_retention_days

  attach_alb        = true
  alb_listener_arn  = data.terraform_remote_state.runtime.outputs.https_listener_arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  alb_host_headers  = [var.api_domain] # host-based routing on the shared ALB
  health_check_path = "/v1/healthz"

  # Cache is the shared ElastiCache replication group (module.cache), not an
  # in-task sidecar — so sessions in Valkey survive api deploys/recycles.

  # Includes the AWS-managed RDS secret: the execution role needs GetSecretValue
  # on it to inject DATABASE_USER/PASSWORD. Omit it and the task cannot start at
  # all ("unable to pull secrets") — it is not a runtime error, it is a boot
  # failure. The migrator reuses this role, so it is covered here too.
  # Includes the AWS-managed RDS secret: the execution role needs GetSecretValue on it
  # to inject DATABASE_USER/PASSWORD. Omit it and the task cannot start at all ("unable
  # to pull secrets") — a boot failure, not a runtime error. The migrator reuses this
  # role, so it is covered here too.
  secret_arns = concat(values(module.secrets.secret_arns), [module.rds.master_secret_arn])
  kms_key_arn = local.kms_key_arn
  secrets = concat(local.api_db_secrets, [
    # DB credentials come from local.api_db_secrets above: the RDS-managed secret
    # AWS owns and rotates, or the rally_app password once db_least_privilege is
    # on. Never a hand-maintained copy either way. `:key::` selects one JSON field.
    #
    # This replaced a static `db-url` secret. That copy went stale on every
    # rotation and the next deploy died with 28P01 (auth failed for app_admin),
    # with nothing drifting in Terraform to explain why. Host/port/name are
    # non-secret and passed as plain env below; the app composes the URL.
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    # GitHub App webhook HMAC secret — the API verifies X-Hub-Signature-256 on
    # inbound SCM webhooks (/v1/scm/webhook/*). Absent → the receiver returns 503,
    # no boot impact. Execution-role read is covered by secret_arns above.
    { name = "GITHUB_WEBHOOK_SECRET", secret_arn = module.secrets.secret_arns["github-webhook-secret"] },
    # Cloudflare R2 bucket-scoped credentials (S3-compatible SigV4).
    { name = "STORAGE_ACCESS_KEY_ID", secret_arn = module.secrets.secret_arns["r2-access-key-id"] },
    { name = "STORAGE_SECRET_ACCESS_KEY", secret_arn = module.secrets.secret_arns["r2-secret-access-key"] },
    ], var.storage_public_credentials ? [
    # Public-bucket-scoped pair, injected only once populated. NOT unconditional: the
    # deploy preflight blocks on an injected secret that holds no value, so wiring these
    # while empty broke every develop deploy. See the variable.
    { name = "STORAGE_PUBLIC_ACCESS_KEY_ID", secret_arn = module.secrets.secret_arns["r2-public-access-key-id"] },
    { name = "STORAGE_PUBLIC_SECRET_ACCESS_KEY", secret_arn = module.secrets.secret_arns["r2-public-secret-access-key"] },
  ] : [])

  environment_vars = concat(local.api_db_env, [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "AWS_REGION", value = var.region },
    # Non-secret connection parts; DATABASE_USER/PASSWORD arrive via secrets.
    { name = "DATABASE_HOST", value = module.rds.address },
    { name = "DATABASE_PORT", value = tostring(module.rds.port) },
    { name = "DATABASE_NAME", value = module.rds.db_name },
    { name = "CORS_ORIGINS", value = local.app_base_url },
    { name = "APP_BASE_URL", value = local.app_base_url },
    # JWT config — defaults match app .env.example; override if needed
    { name = "JWT_ISSUER", value = "${var.product}-api" },
    { name = "JWT_AUDIENCE", value = "${var.product}-web" },
    { name = "JWT_ACCESS_EXPIRY", value = "15m" },
    { name = "JWT_REFRESH_EXPIRY", value = "30d" },
    # Microsoft Entra SSO (BFF) — all Entra vars are mandatory; the API fails to boot without them.
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "ENTRA_REDIRECT_URI", value = "${local.app_base_url}/v1/bff/callback" },
    # GitHub App (SCM org-level auto-discovery + backfill). The API enumerates
    # the App's installations and mints installation tokens, so — like the worker —
    # it needs the App ID + private-key ref. Empty App ID keeps it dormant
    # (GithubAppAuthService.isConfigured() = false). Task role reads all secrets.
    { name = "GITHUB_APP_ID", value = var.github_app_id },
    { name = "GITHUB_APP_PRIVATE_KEY_SECRET_REF", value = module.secrets.secret_arns["github-app-private-key"] },
    # Multi-IdP broker: the home (company Entra) connection resolves its client
    # secret at RUNTIME from this ref. Reuses entra-client-secret (same Entra
    # app) — no duplicate copy to drift on rotation. Unset leaves the broker
    # home path dormant (legacy GET /bff/login unaffected). The task role is
    # granted GetSecretValue on it via task_secret_arns below.
    { name = "IDENTITY_HOME_SECRET_REF", value = module.secrets.secret_arns["entra-client-secret"] },
    # Comma-separated emails auto-granted workspace_admin on every SSO login
    { name = "PLATFORM_ADMIN_EMAILS", value = join(",", var.platform_admin_emails) },
    # Messaging — SQS queue URLs injected at deploy time from module outputs
    { name = "SQS_NOTIFICATIONS_URL", value = module.messaging.queue_urls["notifications"] },
    { name = "SQS_AUDIT_URL", value = module.messaging.queue_urls["audit"] },
    { name = "SQS_REPORTING_URL", value = module.messaging.queue_urls["reporting"] },
    { name = "SQS_SEARCH_URL", value = module.messaging.queue_urls["search"] },
    { name = "SNS_TOPIC_ARN", value = module.messaging.topic_arns["domain-events"] },
    # Attachments object storage — Cloudflare R2 (S3-compatible) from the platform
    # storage-dev stack. Bucket name still travels as S3_ATTACHMENTS_BUCKET; the
    # presence of STORAGE_ENDPOINT flips StorageService to the R2 endpoint + keys.
    { name = "S3_ATTACHMENTS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_name"] },
    # Separate PUBLIC bucket for avatars/logos. StorageService refuses to store a
    # public asset when this is unset rather than falling back to the private
    # bucket — a silent fallback would put world-readable objects next to
    # permission-gated ones.
    { name = "S3_PUBLIC_ASSETS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_public_assets_name"] },
    # CDN_PUBLIC_ASSETS_BASE_URL is deliberately NOT set yet — the public bucket
    # has no custom domain until cf-r2-v1.1.0 ships. Unset means public assets
    # fall back to a presigned GET, which is correct, just not edge-cached.
    # When wiring it: source it from the storage stack output, never hand-enter
    # it, and never point it at the attachments bucket.
    { name = "STORAGE_ENDPOINT", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_endpoint"] },
    { name = "STORAGE_FORCE_PATH_STYLE", value = "true" },
    # Email — SES in production
    { name = "EMAIL_PROVIDER", value = "ses" },
    # Observability
    { name = "LOG_LEVEL", value = "info" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "OTEL_SERVICE_NAME", value = "${var.product}-api" },
    # Gated on the sidecar actually existing, so the app can never export into a
    # void. False until observability.otlp_endpoint is set.
    { name = "OTEL_ENABLED", value = tostring(module.otel_agent_api.enabled) },
    { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = module.otel_agent_api.endpoint },
  ], local.otel_env)

  # Merged into the task definition; reachable from the app at 127.0.0.1 via the
  # shared task network namespace. Empty list until a backend is configured.
  additional_containers = module.otel_agent_api.container_definitions

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)

  # Multi-IdP broker: the TASK role reads per-connection OIDC client secrets at
  # RUNTIME (resolved from the sso_connections row on demand). The home
  # connection reuses entra-client-secret; the sso/* prefix covers future
  # vendor connections added out-of-band (create the secret + the DB row, no TF
  # change). Distinct from secret_arns above (execution role, boot-time inject).
  task_secret_arns = [
    # Resolved at RUNTIME by SecretsManagerSecretResolver under the task role, not
    # injected at boot: the broker's home connection needs the Entra secret when a login
    # happens, and listAvailable/connect mint the GitHub App JWT on demand.
    module.secrets.secret_arns["entra-client-secret"],
    module.secrets.secret_arns["github-app-private-key"],
    # Future per-connection OIDC secrets, created out of band (a secret plus an
    # sso_connections row, no Terraform change), so the grant has to be a wildcard.
    "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.product}/${var.env}/sso/*",
  ]

  tags = merge(local.tags, { Service = "api" })
}

# ── ECS Service — Worker ──────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v2.0.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = var.region
  image_uri    = local.ecr_worker_url

  cpu    = var.worker.cpu
  memory = var.worker.memory

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = var.worker.max_count
  use_spot           = var.worker.use_spot
  log_retention_days = var.log_retention_days

  attach_alb = false

  # Worker has no HTTP listener — check the node process is alive instead
  health_check_command = "pgrep -x node || exit 1"
  container_port       = 3001

  # Cache is the shared ElastiCache replication group (module.cache) — the
  # worker and api now share one cache, so their Redis pub/sub (notification
  # wake-ups) actually connects across tasks instead of each hitting its own
  # isolated sidecar.

  # Includes the AWS-managed RDS secret: the execution role needs GetSecretValue
  # on it to inject DATABASE_USER/PASSWORD. Omit it and the task cannot start at
  # all ("unable to pull secrets") — it is not a runtime error, it is a boot
  # failure. The migrator reuses this role, so it is covered here too.
  # Includes the AWS-managed RDS secret: the execution role needs GetSecretValue on it
  # to inject DATABASE_USER/PASSWORD. Omit it and the task cannot start at all ("unable
  # to pull secrets") — a boot failure, not a runtime error. The migrator reuses this
  # role, so it is covered here too.
  secret_arns = concat(values(module.secrets.secret_arns), [module.rds.master_secret_arn])
  kms_key_arn = local.kms_key_arn
  secrets = concat(local.worker_db_secrets, [
    # DB credentials come from local.worker_db_secrets above: the RDS-managed
    # secret AWS owns and rotates, or the rally_worker password once
    # db_least_privilege is on. Never a hand-maintained copy either way.
    #
    # This replaced a static `db-url` secret. That copy went stale on every
    # rotation and the next deploy died with 28P01 (auth failed for app_admin),
    # with nothing drifting in Terraform to explain why. Host/port/name are
    # non-secret and passed as plain env below; the app composes the URL.
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    # Shared schema requires CSRF_SECRET even though the worker never uses it as middleware
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
    { name = "COOKIE_SECRET", secret_arn = module.secrets.secret_arns["cookie-secret"] },
    # Shared schema also validates the Entra client secret at boot (worker runs the same env schema).
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    # Cloudflare R2 bucket-scoped credentials (worker also reads/writes attachments).
    { name = "STORAGE_ACCESS_KEY_ID", secret_arn = module.secrets.secret_arns["r2-access-key-id"] },
    { name = "STORAGE_SECRET_ACCESS_KEY", secret_arn = module.secrets.secret_arns["r2-secret-access-key"] },
    ], var.storage_public_credentials ? [
    # Public-bucket-scoped pair, injected only once populated. NOT unconditional: the
    # deploy preflight blocks on an injected secret that holds no value, so wiring these
    # while empty broke every develop deploy. See the variable.
    { name = "STORAGE_PUBLIC_ACCESS_KEY_ID", secret_arn = module.secrets.secret_arns["r2-public-access-key-id"] },
    { name = "STORAGE_PUBLIC_SECRET_ACCESS_KEY", secret_arn = module.secrets.secret_arns["r2-public-secret-access-key"] },
  ] : [])

  # SCM backfill runs in the worker (ScmBackfillRelayService): it resolves the
  # GitHub App private key at RUNTIME to mint the App JWT, so the TASK role — not
  # the execution role — needs GetSecretValue on it. Distinct from secret_arns
  # above (execution role, boot-time inject). Mirrors the api's task_secret_arns.
  task_secret_arns = [
    module.secrets.secret_arns["github-app-private-key"],
  ]

  environment_vars = concat(local.worker_db_env, [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "AWS_REGION", value = var.region },
    # Non-secret connection parts; DATABASE_USER/PASSWORD arrive via secrets.
    { name = "DATABASE_HOST", value = module.rds.address },
    { name = "DATABASE_PORT", value = tostring(module.rds.port) },
    { name = "DATABASE_NAME", value = module.rds.db_name },
    # Entra SSO — the worker validates the shared env schema, so these are required to boot.
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "ENTRA_REDIRECT_URI", value = "${local.app_base_url}/v1/bff/callback" },
    # GitHub App (SCM backfill). App ID stays empty until the App is registered,
    # keeping backfill dormant (GithubAppAuthService.isConfigured() = false). The
    # private-key ref is the SM ARN, resolved at runtime via the task role above.
    { name = "GITHUB_APP_ID", value = var.github_app_id },
    { name = "GITHUB_APP_PRIVATE_KEY_SECRET_REF", value = module.secrets.secret_arns["github-app-private-key"] },
    { name = "SQS_NOTIFICATIONS_URL", value = module.messaging.queue_urls["notifications"] },
    { name = "SQS_AUDIT_URL", value = module.messaging.queue_urls["audit"] },
    { name = "SQS_REPORTING_URL", value = module.messaging.queue_urls["reporting"] },
    { name = "SQS_SEARCH_URL", value = module.messaging.queue_urls["search"] },
    { name = "SNS_TOPIC_ARN", value = module.messaging.topic_arns["domain-events"] },
    # Attachments object storage — Cloudflare R2 (see api service for rationale).
    { name = "S3_ATTACHMENTS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_name"] },
    # Separate PUBLIC bucket for avatars/logos. StorageService refuses to store a
    # public asset when this is unset rather than falling back to the private
    # bucket — a silent fallback would put world-readable objects next to
    # permission-gated ones.
    { name = "S3_PUBLIC_ASSETS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_public_assets_name"] },
    # CDN_PUBLIC_ASSETS_BASE_URL is deliberately NOT set yet — the public bucket
    # has no custom domain until cf-r2-v1.1.0 ships. Unset means public assets
    # fall back to a presigned GET, which is correct, just not edge-cached.
    # When wiring it: source it from the storage stack output, never hand-enter
    # it, and never point it at the attachments bucket.
    { name = "STORAGE_ENDPOINT", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_endpoint"] },
    { name = "STORAGE_FORCE_PATH_STYLE", value = "true" },
    { name = "EMAIL_PROVIDER", value = "ses" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "OTEL_SERVICE_NAME", value = "${var.product}-worker" },
    # Gated on the sidecar actually existing, so the app can never export into a
    # void. False until observability.otlp_endpoint is set.
    { name = "OTEL_ENABLED", value = tostring(module.otel_agent_worker.enabled) },
    { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = module.otel_agent_worker.endpoint },
  ], local.otel_env)

  # Merged into the task definition; reachable from the app at 127.0.0.1 via the
  # shared task network namespace. Empty list until a backend is configured.
  additional_containers = module.otel_agent_worker.container_definitions

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)

  tags = merge(local.tags, { Service = "worker" })
}

# Attachments object storage now lives entirely in Cloudflare R2 (platform
# storage-dev stack; see the api/worker STORAGE_* wiring and the storage remote
# state above). The transitional rollback S3 bucket was retired here after the
# dev R2 round-trip was verified. The prod stack still keeps its S3 rollback
# bucket until the prod R2 cutover is verified.

# ── Migrator (one-shot, run manually or via CI) ───────────────────────────────
# Runs `pnpm migration:run` then exits. Never scheduled as a service; deploy
# pipelines trigger it with: aws ecs run-task ...
module "migrator" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/oneshot-task?ref=oneshot-task-v2.0.0"

  name               = "${local.name}-migrator"
  container_name     = "migrator"
  image              = local.ecr_migrator_url
  cpu                = 512
  memory             = 1024
  execution_role_arn = module.api.execution_role_arn
  task_role_arn      = module.api.task_role_arn
  region             = var.region
  log_retention_days = var.log_retention_days

  environment = {
    NODE_ENV       = "production"
    AWS_REGION     = var.region
    SEED_ON_DEPLOY = tostring(var.seed_on_deploy)
    # Non-secret connection parts; USER/PASSWORD arrive via secrets below.
    DATABASE_HOST = module.rds.address
    DATABASE_PORT = tostring(module.rds.port)
    DATABASE_NAME = module.rds.db_name
    # Required by seed.ts to insert the SSO connection row that maps
    # this Entra directory to the system tenant (acme).
    # Without it, the ssoConnections insert is skipped and SSO login returns 401.
    ENTRA_TENANT_ID = var.entra_tenant_id
    # Broker home connection (identity >= 5.5.0): the seed writes clientId +
    # clientSecretRef onto the home sso_connections row. Without these it seeds
    # null refs and broker home login can't run the confidential-client token
    # exchange. clientSecretRef is a REF (ARN) only — not read at seed time, so
    # no task-role change here (the migrator already reuses module.api's role).
    ENTRA_CLIENT_ID          = var.entra_client_id
    IDENTITY_HOME_SECRET_REF = module.secrets.secret_arns["entra-client-secret"]
    # Invite-only access: the seed writes jitEnabled=false onto the home
    # connection, so SSO authenticates but only invited / already-provisioned
    # users (+ platform-admins) get in. No silent auto-join for any qnsc.vn user.
    SSO_JIT_ENABLED = "false"
  }

  secrets = {
    # The master credential, and it stays that way even when `db_least_privilege`
    # moves the api and worker off it: the migrator runs DDL, so it needs the
    # owner. Narrowing it to `rally_migrate` additionally requires transferring
    # schema ownership (`REASSIGN OWNED BY`), which is step 4 of the runbook and
    # deliberately not bundled with the runtime cutover.
    #
    # Read live from the AWS-managed secret so a rotation can never leave the
    # migrator holding a stale password.
    DATABASE_USER     = "${module.rds.master_secret_arn}:username::"
    DATABASE_PASSWORD = "${module.rds.master_secret_arn}:password::"
  }

  tags = merge(local.tags, { Service = "migrator" })
}

# ── WAF: not used in dev. In prod the WebACL lives in runtime-prod and is
# associated with the shared ALB there. ───────────────────────────────────────

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Replaces the deprecated S3 + CloudFront (cdn) stack. Content is deployed from
# CI with `wrangler pages deploy apps/web/dist`. The SPA is built with an empty
# VITE_API_URL, so it reaches the API through relative /v1/* paths that the
# Pages Function reverse-proxy (apps/web/functions/v1/[[path]].ts) forwards to
# API_ORIGIN. That keeps the SPA and API same-origin under var.app_domain —
# required so the BFF __Host- session cookie is honoured (no cross-site cookie,
# no CORS). Pages provisions the project + custom domain + proxied CNAME. Gated
# on cloudflare_account_id so the stack still applies before the CF account is
# wired.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.1"

  account_id  = var.cloudflare_account_id
  name        = "${local.name}-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? var.app_domain : ""
  record_name = local.cloudflare_zone_id != "" ? var.web_record : ""
  comment     = "${local.name} web SPA → Cloudflare Pages (managed by ${var.product}-infra ${var.env})"

  # Pages Function proxy upstream: /v1/* (incl. /v1/bff/*) is forwarded here so
  # the browser only ever sees the SPA origin (same-origin BFF requirement).
  production_env_vars = {
    API_ORIGIN = "https://${var.api_domain}"
  }
}

# ── DNS — var.api_domain → ALB (Cloudflare-proxied edge) ─────────────────────
# The API's public edge. Cloudflare-proxied (orange cloud) so the ALB is never
# directly reachable — WAF/DDoS/TLS terminate at Cloudflare, and the ALB SG is
# locked to cloudflare_ipv4 above. Cloudflare→origin runs in Full (strict) SSL
# mode; the ALB HTTPS listener serves the *.qnsc.vn cert, which matches the SNI
# var.api_domain. The api ECS service already attaches its /* forward
# rule to that HTTPS listener (see module.api.alb_listener_arn).
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.1.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = var.api_record
  type    = "CNAME"
  content = data.terraform_remote_state.runtime.outputs.alb_dns_name
  proxied = true # orange cloud: shield the ALB, edge WAF/DDoS at Cloudflare
  comment = "${local.name} API → ALB via Cloudflare proxy (managed by ${var.product}-infra ${var.env})"
}

# ── Observability: golden-signal alarms + dashboard ───────────────────────────
# Shared module (7 alarms across ECS/ALB/RDS, one dashboard, one SNS topic with
# email subscriptions). It was tagged months ago and never adopted by any stack,
# which is why this product had no alarms at all until the fail-open one below.
#
# It also OWNS the alert topic, so the topic this stack used to declare inline is
# gone — two topics per environment meant two subscriptions to confirm and two
# places to look. The fail-open alarm below publishes to this module's topic.
module "observability" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/observability?ref=observability-v3.0.0"

  create_dashboard = var.create_dashboard

  name              = local.name
  region            = var.region
  ecs_cluster_name  = module.ecs_cluster.cluster_name
  ecs_service_names = [module.api.service_name, module.worker.service_name]
  # Full ALB ARN — exposed by the runtime stack for exactly this. Without it the
  # module silently skips the two user-facing ALB alarms.
  alb_arn = data.terraform_remote_state.runtime.outputs.alb_arn
  # `identifier` (rally-prod), NOT `instance_id` (db-F35NKOG…). CloudWatch publishes RDS
  # metrics under the DBInstanceIdentifier dimension, and `aws_db_instance.id` returns the
  # RESOURCE id on AWS provider 5.x — so this pointed at a dimension value that does not
  # exist. Six alarms sat in INSUFFICIENT_DATA permanently: RDS CPU, connections and free
  # storage were unmonitored in BOTH environments while appearing covered.
  #
  # observability-v3.0.0 now rejects a resource id outright, so this cannot regress
  # silently — it fails the plan instead.
  rds_instance_id = module.rds.identifier

  # Per-service UnHealthyHostCount. Every other alarm here fires on a symptom of load,
  # so a service whose tasks are simply not running reads as quiet. Scoped by target
  # group because the ALB is shared with other products, and gated because zero tasks is
  # a normal state wherever the cost-saver runs — see the variable.
  target_group_arns = var.monitor_target_health ? { api = module.api.target_group_arn } : {}
  alarm_emails      = var.alarm_emails
  tags              = local.tags
}

# ── Alerting: security controls that failed OPEN ──────────────────────────────
# The access-token denylist (JwtAuthGuard) and the rate limiter both fail open
# when Valkey is unreachable — individually correct, but together a cache outage
# accepts revoked tokens AND serves unlimited traffic with no signal. The app tags
# those log lines with `securityFailOpen`; this turns them into a metric + alarm.
#
# Log-based, not OTel-based, ON PURPOSE: OTEL_ENABLED is "false" in this
# environment, so a counter would report nothing while looking like monitoring.
# Container logs reach CloudWatch regardless.
#
# The field name is FAIL_OPEN_FIELD in libs/platform/src/observability/fail-open.ts.
# Renaming it there silently breaks this filter.
resource "aws_cloudwatch_log_metric_filter" "security_fail_open" {
  name           = "${local.name}-security-fail-open"
  log_group_name = module.api.log_group_name
  pattern        = "{ $.securityFailOpen = \"*\" }"

  metric_transformation {
    name          = "SecurityFailOpen"
    namespace     = "${var.product}/${var.env}"
    value         = "1"
    default_value = "0"
  }
}


resource "aws_cloudwatch_metric_alarm" "security_fail_open" {
  alarm_name        = "${local.name}-security-fail-open"
  alarm_description = "A security control failed open (token denylist or rate limiter) — check Valkey health."

  namespace           = "${var.product}/${var.env}"
  metric_name         = "SecurityFailOpen"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # A metric filter emits no data points when nothing matches, which is the
  # healthy state — treat that as OK rather than INSUFFICIENT_DATA noise.
  treat_missing_data = "notBreaching"

  alarm_actions = [module.observability.alarm_topic_arn]
  ok_actions    = [module.observability.alarm_topic_arn]
}

# ── Guard: the sidecar log groups must match the ones ecs-service creates ──────
# `local.{api,worker}_log_group` is COMPUTED rather than read from
# `module.<svc>.log_group_name`, because reading it would form a cycle: the agent
# needs a log group, the service needs the agent's container definition, and the
# service is what creates the log group.
#
# That means this stack now depends on `ecs-service` naming its log group
# `/ecs/<cluster>-<service>`. A `check` block is evaluated AFTER the resources it
# references, so it can assert the coupling without recreating the cycle. If a
# future ecs-service release renames the group, the collector would silently log
# into a group nobody reads — this turns that into a loud failure instead.
check "otel_agent_log_groups_match_services" {
  assert {
    condition     = local.api_log_group == module.api.log_group_name
    error_message = "api sidecar log group '${local.api_log_group}' != '${module.api.log_group_name}'. ecs-service changed its log-group naming; update local.api_log_group."
  }

  assert {
    condition     = local.worker_log_group == module.worker.log_group_name
    error_message = "worker sidecar log group '${local.worker_log_group}' != '${module.worker.log_group_name}'. ecs-service changed its log-group naming; update local.worker_log_group."
  }
}
