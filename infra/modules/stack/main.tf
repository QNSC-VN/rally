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
  # When the cache is disabled (an idled environment) this is a deliberately
  # UNRESOLVABLE address rather than an empty string or an omitted variable.
  #
  # `env.schema.ts` declares `REDIS_URL: z.string().default('redis://localhost:6379')`,
  # so omitting it makes a deployed task fall back to LOCALHOST — and the token denylist
  # and rate limiter both FAIL OPEN when Valkey is unreachable. A task booted without a
  # cache would therefore run with two security controls degraded instead of failing.
  # An empty string is no better: it is a valid string, so the schema accepts it.
  #
  # `.invalid` is reserved by RFC 2606 and can never resolve, so the failure is a loud
  # DNS error naming the cause. The real guard is still the `check` block at the bottom
  # of this file: with the cache off, no task may run at all.
  redis_url = var.cache.enabled ? "rediss://${module.cache[0].endpoint}:${module.cache[0].port}" : "rediss://cache-disabled.invalid:6379"

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
# The secret set this stack owns. Hoisted into a local rather than written inline in
# `module.secrets` so that `local.secret_iam_arns` below can derive the IAM resource
# list from the SAME keys — one definition, so the grant cannot drift from the set.
locals {
  secret_names = merge(var.observability.otlp_endpoint == "" ? {} : {
    # The COMPLETE Authorization header the collector sidecar sends upstream, e.g.
    # `Basic base64(instanceID:token)` — not the bare token. Assembling it in Terraform
    # would put the instance id in state and the credential in the collector's plaintext
    # config.
    "observability-token" = "Authorization header for the OTLP backend (e.g. 'Basic <base64>')"
    }, {
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
    # Scoped to <product>-<env>-attachments ONLY. The public bucket gets its own pair
    # below, gated on `storage_public_credentials` — one token per bucket, so a leaked
    # avatar-writer cannot read permission-gated attachments.
    #
    # This comment previously demanded the OPPOSITE (one token scoped to both buckets),
    # because StorageService then used a single S3 client for both. It no longer does:
    # `clientFor(visibility)` picks the public pair when injected. The comment outlived
    # that change, and the tokens in Cloudflare were attachments-only the whole time —
    # so the file documented a requirement reality never met, and public writes 403'd.
    # R2 tokens are minted by hand in the Cloudflare dashboard; add a BUCKET, add a TOKEN.
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
    # Cloudflare Tunnel connector token, consumed by the cloudflared sidecar as
    # TUNNEL_TOKEN. Created out of band with the tunnel itself (a tunnel and its token
    # are one object in Cloudflare — Terraform does not mint this), then pasted into the
    # bundle. Present in `secret_names` so `secret_arns["tunnel-token"]` resolves and so
    # the key shows up in the bundle's generated description; the IAM grant is the whole
    # bundle either way.
    "tunnel-token"       = "Cloudflare Tunnel connector token (cloudflared TUNNEL_TOKEN)"
    "db-app-password"    = "Password for the rally_app Postgres role (api) — set with the LOGIN grant"
    "db-worker-password" = "Password for the rally_worker Postgres role (worker) — set with the LOGIN grant"
  })
}

module "secrets" {
  source      = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v2.1.0"
  prefix      = "${var.product}/${var.env}"
  kms_key_arn = local.kms_key_arn

  # Dev: delete secrets immediately on teardown (no 7-day recovery window) so a
  # destroy+redeploy cycle doesn't hit "secret scheduled for deletion" on the
  # recreate. Prod keeps the default recovery window for safety.
  recovery_window_days = var.secrets_recovery_window_days

  # Cost: collapse the set into one JSON secret. Staged across four applies — see
  # `secrets_bundle_name` in variables.tf for the ordering and why it is staged.
  bundle_name       = var.secrets_bundle_name
  use_bundle        = var.secrets_use_bundle
  create_standalone = var.secrets_create_standalone

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
  # Merged rather than a flat map so `observability-token` can be omitted entirely while
  # the OTel path is dormant. A secret that is deliberately never populated AND never
  # injected is a resource with no purpose — it still bills $0.40/mo per environment, and
  # more to the point it shows up in every audit of "which secrets are unpopulated?" as a
  # permanent false positive, which is how a real unpopulated secret gets overlooked.
  secret_names = local.secret_names

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
  count  = var.cache.enabled ? 1 : 0
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
# ── Cloudflare Tunnel ─────────────────────────────────────────────────────────
# Created by Terraform via the shared cf-tunnel module. Both of rally's tunnels predate
# it and were made in the dashboard, so live/*/main.tf carries an `import` block that
# adopts each one — the module ignores `secret` precisely so that adoption is a no-op
# rather than a rotation. Rotating the secret would change the connector token, and every
# running cloudflared would be left holding one that no longer authenticates.
module "tunnel" {
  count  = var.tunnel_enabled && var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cf-tunnel?ref=cf-tunnel-v0.2.0"

  account_id = var.cloudflare_account_id
  name       = local.name

  // ── STEP ONE OF TWO: ADOPT THE TUNNEL, CHANGE NOTHING ─────────────────────
  // `hostname` is deliberately left unset, so this module creates NO configuration
  // resource and rally keeps the routing it has today.
  //
  // That restraint is the whole point. Cloudflare's tunnel-configuration API is a
  // whole-document PUT, so writing a partial rule set silently discards anything the
  // live configuration holds that this file does not reproduce — against a tunnel that
  // is currently carrying traffic, on a hostname nobody has compared rule-by-rule.
  //
  // config_src must equal what the tunnel ALREADY has, or the import rewrites how a
  // working connector is configured. A dashboard-created tunnel serving a public
  // hostname is normally "cloudflare"; CONFIRM IT IN THE PLAN before applying — the plan
  // must show 1 to import and 0 to change.
  //
  // Step two moves routing under Terraform (set `hostname` and `service` to match what
  // the tunnel serves today) as a separate change, once someone has read the existing
  // rules. qnsc-kb already runs that way, having been created rather than adopted.
  config_src = "cloudflare"
}

# The connector token, in its own secret rather than as a key in the bundle.
#
# It cannot share the bundle: that is one JSON object an operator populates by hand, and
# Terraform writing a single key of it would clobber the rest. Separate secrets keep the
# two ownership models apart — this one is Terraform's, the bundle stays the operator's.
#
# MIGRATION NOTE: the bundle's existing `tunnel-token` key is left in place and simply
# stops being referenced. Nothing deletes it, so a rollback is a one-line revert, and the
# api task keeps serving from its current task definition until the next deploy moves it
# onto this ARN.
resource "aws_secretsmanager_secret" "tunnel_token" {
  count = var.tunnel_enabled && var.cloudflare_account_id != "" ? 1 : 0

  name                    = "${var.product}/${var.env}/tunnel-token-tf"
  description             = "Cloudflare Tunnel connector token (TUNNEL_TOKEN). Managed by Terraform — do not edit by hand."
  kms_key_id              = local.kms_key_arn
  recovery_window_in_days = var.secrets_recovery_window_days

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "tunnel_token" {
  count = var.tunnel_enabled && var.cloudflare_account_id != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.tunnel_token[0].id
  secret_string = module.tunnel[0].token
}

# ── Cloudflare Tunnel sidecar (api only) ──────────────────────────────────────
# Ingress WITHOUT an ALB: cloudflared dials out to Cloudflare, so the task needs no
# inbound listener and no public IPv4. Gated on `tunnel_token_secret_arn` — empty
# means no sidecar, so this is inert until a tunnel exists for the environment.
#
# The worker gets none: it is a relay with no HTTP surface and `attach_alb = false`
# already.
#
# SSE was the compatibility question and it is answered: NotificationSseController
# writes a `: heartbeat` every 25s, inside Cloudflare's ~100s idle timeout.
module "tunnel_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/tunnel-agent?ref=tunnel-agent-v1.0.0"

  tunnel_token_secret_arn = length(aws_secretsmanager_secret.tunnel_token) > 0 ? aws_secretsmanager_secret.tunnel_token[0].arn : ""
  app_port                = 3000
  log_group               = local.api_log_group
  region                  = var.region
}

module "otel_agent_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/observability-agent?ref=observability-agent-v1.0.0"

  product       = var.product
  env           = var.env
  otlp_endpoint = var.observability.otlp_endpoint
  # try(): the secret is not created while the OTel path is dormant, and this module is a
  # no-op in that state anyway — so an absent ARN is the correct input, not an error.
  token_secret_arn = try(module.secrets.secret_arns["observability-token"], "")
  log_group        = local.api_log_group
  region           = var.region

  cpu              = local.otel_api_cpu
  memory           = local.otel_api_memory
  memory_limit_mib = floor(local.otel_api_memory * 0.625)
}

module "otel_agent_worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/observability-agent?ref=observability-agent-v1.0.0"

  product       = var.product
  env           = var.env
  otlp_endpoint = var.observability.otlp_endpoint
  # try(): the secret is not created while the OTel path is dormant, and this module is a
  # no-op in that state anyway — so an absent ARN is the correct input, not an error.
  token_secret_arn = try(module.secrets.secret_arns["observability-token"], "")
  log_group        = local.worker_log_group
  region           = var.region

  cpu              = local.otel_worker_cpu
  memory           = local.otel_worker_memory
  memory_limit_mib = floor(local.otel_worker_memory * 0.625)
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
  # IAM resource list for the secret containers this stack owns.
  #
  # NOT `module.secrets.secret_iam_arns`, even though that is the semantically right
  # output. It is built from `aws_secretsmanager_secret.*.arn`, which is unknown until
  # apply — and `ecs-service` uses `length(var.secret_arns)` in a `count`, so an unknown
  # LENGTH fails the plan outright with "Invalid count argument". The contents may be
  # unknown at plan time; the length may not.
  #
  # Constructing the ARNs from names keeps the length static (a function of
  # `local.secret_names` and the two bundling flags, all known inputs). Secrets Manager
  # appends a random 6-character suffix to every ARN, so these carry a trailing `-*`
  # wildcard — which is how the AWS docs themselves recommend writing a secret ARN in an
  # IAM policy when the suffix is not known.
  #
  # Kept in lockstep with the module's own output: same containers, same modes. If the
  # module's naming changes, this breaks with it.
  secret_name_prefix = "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.product}/${var.env}"

  secrets_standalone_exist = coalesce(var.secrets_create_standalone, !var.secrets_use_bundle)

  secret_iam_arns = concat(
    local.secrets_standalone_exist ? [
      for k in keys(local.secret_names) : "${local.secret_name_prefix}/${k}-*"
    ] : [],
    var.secrets_bundle_name != "" ? ["${local.secret_name_prefix}/${var.secrets_bundle_name}-*"] : [],
  )

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

  # ── Connection-pool budget ──────────────────────────────────────────────────
  # `DATABASE_POOL_MAX` defaults to 20 per PROCESS in env.schema.ts, and nothing
  # here used to set it. That default is a per-task number multiplied by the
  # autoscaler's ceiling, so production could legitimately open
  # 10 api tasks x 20 + 6 worker tasks x 20 = 320 connections against an instance
  # that accepts ~112. The failure mode is not a clean rejection either: the pool
  # queues, `connectionTimeoutMillis` (5s, drizzle.provider.ts) elapses, and every
  # affected request pays five seconds before erroring — while CPU-target
  # autoscaling adds MORE tasks, each bringing its own pool, which starves the
  # database further. Derive the per-task ceiling from the ceiling that matters.
  #
  # Postgres computes max_connections as LEAST(DBInstanceClassMemory/9531392, 5000).
  # Listed per class rather than computed, so an unlisted class fails the plan
  # instead of silently inheriting a number that does not hold for it.
  db_max_connections_by_class = {
    "db.t4g.micro"  = 112
    "db.t4g.small"  = 225
    "db.t4g.medium" = 450
  }
  db_max_connections = local.db_max_connections_by_class[var.rds.instance_class]

  # Reserved off the top: 3 for Postgres' superuser slots, 10 for the migrator
  # one-off task (its own pool, and it runs DURING a deploy while api and worker
  # are still up), 5 for an operator holding a psql session while debugging.
  db_pool_budget = local.db_max_connections - 18

  # Split 60/40 api:worker. The worker's share is not proportional to its task
  # count: AbstractOutboxRelay holds one connection for the whole batch
  # transaction while `processRow` does its work on a SECOND connection, so a
  # relay tick needs at least two per task.
  api_pool_max    = max(4, floor(local.db_pool_budget * 0.6 / var.api.max_count))
  worker_pool_max = max(4, floor(local.db_pool_budget * 0.4 / var.worker.max_count))

  # Public HTTPS origin for the public-assets bucket, from the storage stack's
  # `<product>_public_assets_base_url` output. Null until that stack attaches a
  # `custom_domain`; try() also covers a storage stack applied before the output
  # existed, so this module stays appliable against either.
  #
  # Injected as CDN_PUBLIC_ASSETS_BASE_URL only when non-empty, and that matters:
  # env.schema.ts validates it with `z.string().url()`, so an empty string fails
  # validation and the task refuses to boot. Absent is the supported "no CDN" state;
  # empty is not.
  #
  # NEVER source this from an attachments bucket. Objects on this origin are readable
  # by anyone holding the key, with no auth and no expiry, so pointing it at
  # permission-gated files bypasses every authorization check silently —
  # `StorageService.cdnUrl()` has no private-bucket path for exactly this reason.
  public_assets_base_url = try(
    data.terraform_remote_state.storage.outputs["${var.product}_public_assets_base_url"],
    null,
  )

  # Explicit null check rather than coalesce(): coalesce rejects an empty string as
  # well as null, so `coalesce(x, "")` throws "no non-null, non-empty-string
  # arguments" in precisely the case this guard exists for — storage stack not yet
  # applied, output absent, try() returning null.
  public_assets_cdn_env = (
    local.public_assets_base_url != null && local.public_assets_base_url != ""
    ) ? [
    { name = "CDN_PUBLIC_ASSETS_BASE_URL", value = local.public_assets_base_url },
  ] : []
}

# ── ECS Service — API ─────────────────────────────────────────────────────────
module "api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v2.1.1"

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
  enable_autoscaling = var.api.enable_autoscaling
  min_count          = var.api.min_count
  max_count          = var.api.max_count
  use_spot           = var.api.use_spot
  log_retention_days = var.log_retention_days

  # Both callers set these; neither reached the module until now, so production ran on
  # the ecs-service defaults (65/75) while ../../live/prod/main.tf said 60/70.
  cpu_target_pct    = var.api.cpu_target_pct
  memory_target_pct = var.api.memory_target_pct

  attach_alb = !var.tunnel_enabled
  # try(): the runtime layer stops exporting ALB outputs entirely once its ALB is
  # deleted (enable_alb = false), so this attribute is ABSENT rather than null. A
  # tunnelled stack does not attach to a listener anyway — attach_alb is false above.
  alb_listener_arn  = try(data.terraform_remote_state.runtime.outputs.https_listener_arn, "")
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
  #
  # `secret_iam_arns`, NOT `secret_arns`: this is an IAM resource list. The two outputs
  # are identical while secrets are standalone, but once `use_bundle` is on `secret_arns`
  # returns "<arn>:<key>::" — a valueFrom reference, not an ARN — and an IAM statement
  # built from those matches NOTHING while still applying cleanly. The failure surfaces
  # at the next task start as "unable to pull secrets", long after the apply reported
  # success. `secret_iam_arns` returns the container ARNs in both modes.
  secret_arns = concat(local.secret_iam_arns, [module.rds.master_secret_arn])
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
    # Per-task pool ceiling, derived from the RDS class — see local.api_pool_max.
    { name = "DATABASE_POOL_MAX", value = tostring(local.api_pool_max) },
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
    # Attachments object storage — Cloudflare R2 (S3-compatible) from the platform
    # storage-dev stack. Bucket name still travels as S3_ATTACHMENTS_BUCKET; the
    # presence of STORAGE_ENDPOINT flips StorageService to the R2 endpoint + keys.
    { name = "S3_ATTACHMENTS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_name"] },
    # Separate PUBLIC bucket for avatars/logos. StorageService refuses to store a
    # public asset when this is unset rather than falling back to the private
    # bucket — a silent fallback would put world-readable objects next to
    # permission-gated ones.
    { name = "S3_PUBLIC_ASSETS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_public_assets_name"] },
    # CDN_PUBLIC_ASSETS_BASE_URL travels via local.public_assets_cdn_env at the end of
    # this list, sourced from the storage stack rather than hand-entered.
    #
    # An earlier version of this comment said an unset value meant public assets "fall
    # back to a presigned GET, which is correct, just not edge-cached". That was wrong:
    # there is no fallback for the avatar surface. cdnUrl() returns null and the API
    # rejects the upload with 409 "Avatar storage is not configured (no public CDN base
    # URL)", which is what develop did until the buckets got a custom domain.
    { name = "STORAGE_ENDPOINT", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_endpoint"] },
    { name = "STORAGE_FORCE_PATH_STYLE", value = "true" },
    # Email — SES in production. The sender is REQUIRED alongside the provider: without it the API
    # now fails at boot by design, because the old behaviour was to send every message as
    # `"Mini Rally" <>`, collect an SES rejection for each, open the email circuit breaker for the
    # life of the process — and go on reporting healthy.
    { name = "EMAIL_PROVIDER", value = "ses" },
    { name = "MAIL_FROM_EMAIL", value = var.mail_from_email },
    # Observability
    { name = "LOG_LEVEL", value = "info" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "OTEL_SERVICE_NAME", value = "${var.product}-api" },
    # Gated on the sidecar actually existing, so the app can never export into a
    # void. False until observability.otlp_endpoint is set.
    { name = "OTEL_ENABLED", value = tostring(module.otel_agent_api.enabled) },
    { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = module.otel_agent_api.endpoint },
  ], local.public_assets_cdn_env, local.otel_env)

  # Merged into the task definition; reachable from the app at 127.0.0.1 via the
  # shared task network namespace. Empty list until a backend is configured.
  # Both sidecars. concat, not replace — the otel agent and the tunnel connector are
  # independent and either may be a no-op depending on its own gate.
  additional_containers = concat(
    module.otel_agent_api.container_definitions,
    module.tunnel_api.container_definitions,
  )


  # Multi-IdP broker: the TASK role reads per-connection OIDC client secrets at
  # RUNTIME (resolved from the sso_connections row on demand). The home
  # connection reuses entra-client-secret; the sso/* prefix covers future
  # vendor connections added out-of-band (create the secret + the DB row, no TF
  # change). Distinct from secret_arns above (execution role, boot-time inject).
  # IAM RESOURCES, so these must be container ARNs — `secret_arns["<key>"]` is a
  # valueFrom reference and is invalid here once bundled (see the execution role above).
  #
  # SCOPE WIDENS WHEN BUNDLED, deliberately and unavoidably. Standalone, this granted the
  # task role exactly two secrets out of the set. IAM cannot scope below a secret, so a
  # bundle is granted whole or not at all: the task role can now read every key in it,
  # including the R2 credentials and the signing keys it has no use for. That is the cost
  # of bundling, and it is accepted here because the EXECUTION role is already granted the
  # entire set anyway (same task, same instance metadata), so the bundle does not expose
  # material that was previously unreachable from this task.
  #
  # If a value ever needs a genuinely narrower reader than the rest, keep it OUT of the
  # bundle — the module supports a mixed set, and `secret_iam_arns` returns whatever
  # containers exist.
  task_secret_arns = concat(local.secret_iam_arns, [
    # Future per-connection OIDC secrets, created out of band (a secret plus an
    # sso_connections row, no Terraform change), so the grant has to be a wildcard.
    "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.product}/${var.env}/sso/*",
  ])

  tags = merge(local.tags, { Service = "api" })
}

# ── ECS Service — Worker ──────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v2.1.1"

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
  enable_autoscaling = var.worker.enable_autoscaling
  min_count          = var.worker.min_count
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
  # `secret_iam_arns`, NOT `secret_arns` — same reason as the api execution role above:
  # a bundled `secret_arns` yields valueFrom references that are invalid as IAM resources
  # and fail silently at apply time, surfacing only as a boot failure.
  secret_arns = concat(local.secret_iam_arns, [module.rds.master_secret_arn])
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
  # IAM RESOURCES — container ARNs, not valueFrom references. Same widening tradeoff as
  # the api's task_secret_arns above: bundled, this grants the whole object rather than
  # the one key, because IAM cannot scope below a secret.
  task_secret_arns = local.secret_iam_arns

  environment_vars = concat(local.worker_db_env, [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "AWS_REGION", value = var.region },
    # Non-secret connection parts; DATABASE_USER/PASSWORD arrive via secrets.
    { name = "DATABASE_HOST", value = module.rds.address },
    { name = "DATABASE_PORT", value = tostring(module.rds.port) },
    { name = "DATABASE_NAME", value = module.rds.db_name },
    # Per-task pool ceiling, derived from the RDS class — see local.worker_pool_max.
    { name = "DATABASE_POOL_MAX", value = tostring(local.worker_pool_max) },
    # Entra SSO — the worker validates the shared env schema, so these are required to boot.
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "ENTRA_REDIRECT_URI", value = "${local.app_base_url}/v1/bff/callback" },
    # GitHub App (SCM backfill). App ID stays empty until the App is registered,
    # keeping backfill dormant (GithubAppAuthService.isConfigured() = false). The
    # private-key ref is the SM ARN, resolved at runtime via the task role above.
    { name = "GITHUB_APP_ID", value = var.github_app_id },
    { name = "GITHUB_APP_PRIVATE_KEY_SECRET_REF", value = module.secrets.secret_arns["github-app-private-key"] },
    # Attachments object storage — Cloudflare R2 (see api service for rationale).
    { name = "S3_ATTACHMENTS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_name"] },
    # Separate PUBLIC bucket for avatars/logos. StorageService refuses to store a
    # public asset when this is unset rather than falling back to the private
    # bucket — a silent fallback would put world-readable objects next to
    # permission-gated ones.
    { name = "S3_PUBLIC_ASSETS_BUCKET", value = data.terraform_remote_state.storage.outputs["${var.product}_public_assets_name"] },
    # CDN_PUBLIC_ASSETS_BASE_URL travels via local.public_assets_cdn_env at the end of
    # this list, sourced from the storage stack rather than hand-entered.
    #
    # An earlier version of this comment said an unset value meant public assets "fall
    # back to a presigned GET, which is correct, just not edge-cached". That was wrong:
    # there is no fallback for the avatar surface. cdnUrl() returns null and the API
    # rejects the upload with 409 "Avatar storage is not configured (no public CDN base
    # URL)", which is what develop did until the buckets got a custom domain.
    { name = "STORAGE_ENDPOINT", value = data.terraform_remote_state.storage.outputs["${var.product}_attachments_endpoint"] },
    { name = "STORAGE_FORCE_PATH_STYLE", value = "true" },
    # The WORKER sends too — the notification relay is its job — so it needs the sender for the
    # same reason the api task does.
    { name = "EMAIL_PROVIDER", value = "ses" },
    { name = "MAIL_FROM_EMAIL", value = var.mail_from_email },
    { name = "LOG_LEVEL", value = "info" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "OTEL_SERVICE_NAME", value = "${var.product}-worker" },
    # Gated on the sidecar actually existing, so the app can never export into a
    # void. False until observability.otlp_endpoint is set.
    { name = "OTEL_ENABLED", value = tostring(module.otel_agent_worker.enabled) },
    { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = module.otel_agent_worker.endpoint },
  ], local.public_assets_cdn_env, local.otel_env)

  # Merged into the task definition; reachable from the app at 127.0.0.1 via the
  # shared task network namespace. Empty list until a backend is configured.
  additional_containers = module.otel_agent_worker.container_definitions


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

  secrets = merge({
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
    },
    # The least-privilege role passwords, for the ONE-OFF cutover task only:
    #   aws ecs run-task --task-definition <name>-migrator --overrides \
    #     '{"containerOverrides":[{"name":"migrator","command":
    #       ["node","dist/db/enable-least-privilege-roles.js"]}]}'
    #
    # They live on the migrator because it is the ONLY workload that holds the RDS
    # master credential and sits in the database's subnets. RDS is not publicly
    # accessible and ECS Exec is disabled on every service, so there is no other
    # route to run `ALTER ROLE ... LOGIN PASSWORD`.
    #
    # `run-task --overrides` cannot add SECRETS — containerOverrides supports
    # `environment` only — so passing them at invocation time would mean plaintext
    # passwords in the API call. They have to be on the task definition.
    #
    # The normal entrypoint (`node dist/db/migrate.js`) ignores these, so the
    # migrator's behaviour is unchanged when the flag is on.
    var.db_role_passwords_set ? {
      DATABASE_APP_PASSWORD    = module.secrets.secret_arns["db-app-password"]
      DATABASE_WORKER_PASSWORD = module.secrets.secret_arns["db-worker-password"]
  } : {})

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

  # Tunnel or ALB, and the CNAME target is the whole difference:
  #   tunnel — <tunnel-id>.cfargotunnel.com, a Cloudflare-internal name that only
  #            resolves through the edge. It CANNOT be unproxied: an orange-cloud
  #            record is the only way traffic reaches a connector.
  #   ALB    — the load balancer's public DNS name.
  content = var.tunnel_enabled ? one(module.tunnel[*].cname) : data.terraform_remote_state.runtime.outputs.alb_dns_name

  proxied = true # orange cloud: required for a tunnel, and shields the ALB otherwise
  comment = var.tunnel_enabled ? "${local.name} API → Cloudflare Tunnel (managed by ${var.product}-infra ${var.env})" : "${local.name} API → ALB via Cloudflare proxy (managed by ${var.product}-infra ${var.env})"
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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/observability?ref=observability-v4.1.0"

  create_dashboard = var.create_dashboard

  name              = local.name
  region            = var.region
  ecs_cluster_name  = module.ecs_cluster.cluster_name
  ecs_service_names = [module.api.service_name, module.worker.service_name]
  # Full ALB ARN — exposed by the runtime stack for exactly this. Without it the
  # module silently skips the two user-facing ALB alarms.
  alb_arn = try(data.terraform_remote_state.runtime.outputs.alb_arn, "")
  # `identifier` (rally-prod), NOT `instance_id` (db-F35NKOG…). CloudWatch publishes RDS
  # metrics under the DBInstanceIdentifier dimension, and `aws_db_instance.id` returns the
  # RESOURCE id on AWS provider 5.x — so this pointed at a dimension value that does not
  # exist. Six alarms sat in INSUFFICIENT_DATA permanently: RDS CPU, connections and free
  # storage were unmonitored in BOTH environments while appearing covered.
  #
  # observability-v3.0.0 now rejects a resource id outright, so this cannot regress
  # silently — it fails the plan instead.
  rds_instance_id = module.rds.identifier

  # Drives BOTH per-target-group alarms: response latency and UnHealthyHostCount.
  # Scoped by target group because the ALB is shared with other products — a
  # load-balancer-wide dimension aggregated rally and opshub into one p95 and paged
  # under a rally name for traffic that was not always rally's.
  #
  # Passed unconditionally now. It used to be gated on `monitor_target_health`, which
  # meant develop — where the cost-saver makes zero tasks a normal state — gave up
  # LATENCY monitoring to silence the health alarm. Only the health alarm needs that
  # opt-out; the latency alarm evaluates nothing in a period with no traffic.
  # EMPTY when the api is served by a tunnel: there is no ALB target group, so the
  # two target-group alarms (response latency, UnHealthyHostCount) have nothing to
  # read and the module would fail on a null ARN.
  #
  # This is a REAL LOSS OF COVERAGE, not just plumbing. ../../live/prod/main.tf calls
  # monitor_target_health "the only alarm that catches an outage producing no load to
  # move CPU, latency or 5xx" — and with no ALB nothing on the AWS side observes
  # ingress at all. Replace it OUTSIDE AWS before relying on a tunnel in production: a
  # Cloudflare health check or a synthetic probe against the public hostname. The
  # cloudflared sidecar cannot self-report either, because its image is distroless and
  # carries no shell for an ECS healthCheck (see the tunnel-agent module).
  target_group_arns     = var.tunnel_enabled ? {} : { api = module.api.target_group_arn }
  monitor_target_health = var.monitor_target_health

  // Suppresses the alarms whose premise is "this environment is serving traffic":
  // ECS CPU and memory, ALB 5xx, unhealthy hosts.
  //
  // Idling both environments turned their own alarms into a pager. With no registered
  // targets every request becomes a 503, so HTTPCode_ELB_5XX_Count cleared its
  // threshold from a single browser tab reconnecting to /v1/notifications/stream —
  // 139 requests in a day, against a threshold of 20 per five minutes. And a service
  // scaled to zero makes its CPU metric disappear rather than read zero, so the CPU
  // alarm walked OK -> INSUFFICIENT_DATA -> OK on every wake and mailed an OK notice
  // named "<service>-cpu-high" each time.
  //
  // Derived from the idle posture rather than being its own switch: an environment
  // whose services have a floor of 0 is exactly one that cannot support a load alarm.
  // Tying them together means restoring capacity re-arms the alarms in the same change.
  environment_idle = local.environment_idle
  alarm_emails     = var.alarm_emails
  tags             = local.tags
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

# ── Ingress health, from OUTSIDE AWS ─────────────────────────────────────────
# ONLY created when the api is tunnelled, and it exists to replace something real.
#
# With an ALB, `monitor_target_health` watched UnHealthyHostCount — described in
# ../../live/prod/main.tf as "the only alarm that catches an outage producing no load
# to move CPU, latency or 5xx". A tunnelled task has no target group, so that alarm
# cannot exist, and nothing else on the AWS side observes ingress at all:
#
#   - ECS reports the task RUNNING whether or not cloudflared holds edge connections.
#   - `essential = true` on the sidecar catches the connector CRASHING, not the
#     connector staying up with zero edge connections.
#   - An ECS healthCheck cannot probe it either: the cloudflared image is distroless,
#     so there is no shell for a CMD-SHELL probe (see the tunnel-agent module).
#
# A Route 53 health check probes the PUBLIC hostname from outside AWS, so it exercises
# the whole path a user takes — Cloudflare edge, tunnel, connector, app — rather than
# any single component's opinion of itself. $0.50/mo.
#
# Deliberately checks /v1/healthz, not /v1/readyz: readyz touches postgres and valkey,
# so a database blip would page as an ingress outage. Dependency health is already
# covered by the RDS and fail-open alarms.
#
# `monitor_ingress` is the second gate, and it is what lets a PRE-LAUNCH environment stay
# tunnelled without paying for a check that can only ever be red. Production runs zero
# tasks, so this probe sat in ALARM continuously from the day it was created — paying, every
# minute, to be told about the state the environment is deliberately in.
#
# Both gates are required: `tunnel_enabled` says the ALB alarm cannot do this job,
# `monitor_ingress` says there is something running worth watching.
locals {
  # An environment whose service floors are 0 spends most of its time at zero tasks, and a
  # health check against a hostname with nothing behind it sits in ALARM for every one of
  # those hours. That is the same argument this stack already makes for the LOAD alarms
  # (`environment_idle` on the observability module): a floor of 0 is exactly what makes an
  # alarm about serving traffic meaningless.
  #
  # So it is DERIVED rather than left to a third switch. `monitor_ingress`'s own text used to
  # instruct "TURN IT BACK ON IN THE SAME CHANGE THAT RAISES min_count" — this makes that
  # automatic instead of a thing to remember, which is the difference between a rule and a
  # hope. Raising the floors re-arms the probe in the same change that gives it something to
  # probe.
  environment_idle = var.api.min_count == 0 && var.worker.min_count == 0

  monitor_ingress = var.tunnel_enabled && var.monitor_ingress && !local.environment_idle
}

resource "aws_route53_health_check" "api_ingress" {
  count = local.monitor_ingress ? 1 : 0

  fqdn              = var.api_domain
  type              = "HTTPS"
  port              = 443
  resource_path     = "/v1/healthz"
  failure_threshold = 3
  request_interval  = 30

  # us-east-1 ONLY, and not a copy-paste error: Route 53 health-check metrics are
  # published exclusively to us-east-1 regardless of where the endpoint lives, so the
  # alarm below has to be created there too.
  measure_latency = false

  tags = merge(local.tags, { Name = "${local.name}-api-ingress" })
}

# CloudWatch alarm on the health check. In us-east-1 because that is the only region
# where AWS/Route53 HealthCheckStatus exists.
resource "aws_cloudwatch_metric_alarm" "api_ingress_down" {
  count    = local.monitor_ingress ? 1 : 0
  provider = aws.us_east_1

  alarm_name        = "${local.name}-api-ingress-down"
  alarm_description = "${var.api_domain} is not answering /v1/healthz from outside AWS. With no ALB this is the only ingress alarm — check the cloudflared sidecar's edge connections first."

  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.api_ingress[0].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"

  # Missing data is NOT breaching here. The health checker itself is the thing
  # reporting, and a gap in its own metric is far more likely to be a Route 53
  # reporting hiccup than an outage — treating it as breaching would page on the
  # monitoring, not the service.
  treat_missing_data = "missing"

  alarm_actions = [aws_sns_topic.ingress_alarms_us_east_1[0].arn]
  ok_actions    = [aws_sns_topic.ingress_alarms_us_east_1[0].arn]

  tags = local.tags
}

# The alarm lives in us-east-1, and an SNS action must be in the alarm's own region —
# so the ap-southeast-1 alarm topic cannot be used and this one mirrors it.
resource "aws_sns_topic" "ingress_alarms_us_east_1" {
  count    = local.monitor_ingress ? 1 : 0
  provider = aws.us_east_1

  name = "${local.name}-ingress-alarms"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "ingress_alarms_email" {
  for_each = local.monitor_ingress ? toset(var.alarm_emails) : toset([])
  provider = aws.us_east_1

  topic_arn = aws_sns_topic.ingress_alarms_us_east_1[0].arn
  protocol  = "email"
  endpoint  = each.value
}

# ── Alerting: outbox rows that will never be retried ─────────────────────────
# Every relay (notifications, email, SCM webhook inbox, …) retries a failing row
# with exponential backoff and then gives up, setting status = 'failed'. That row
# is silent work loss: a notification nobody receives, or a pull request that
# never links to its work item. Nothing surfaced it — the state lived only in a
# column someone had to think to query, so the first symptom was a user asking why
# their PR was not showing up.
#
# On the WORKER log group, not the api's: the relays run in the worker. Pointing
# this at the api would match nothing and look like coverage.
#
# Log-based for the same reason as the fail-open alarm above: QueueMetrics already
# counts this, but OTEL_ENABLED is "false" in every deployed environment and no
# collector exists, so that counter reports nothing while appearing to be
# monitoring. Container logs reach CloudWatch either way.
#
# The field name is DEAD_LETTER_FIELD in
# libs/platform/src/outbox/abstract-outbox-relay.ts, and only the TERMINAL failure
# carries it — a row still inside its retry budget does not page. A spec asserts
# the field the application emits is the field filtered on here.
resource "aws_cloudwatch_log_metric_filter" "outbox_dead_letter" {
  name           = "${local.name}-outbox-dead-letter"
  log_group_name = module.worker.log_group_name
  pattern        = "{ $.outboxDeadLetter = \"*\" }"

  metric_transformation {
    name          = "OutboxDeadLetter"
    namespace     = "${var.product}/${var.env}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "outbox_dead_letter" {
  alarm_name        = "${local.name}-outbox-dead-letter"
  alarm_description = "A relay gave up on a row after exhausting its retries — work has been lost. Query the outbox table for status = 'failed'."

  namespace           = "${var.product}/${var.env}"
  metric_name         = "OutboxDeadLetter"
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
# into a group nobody reads. See the mechanism note below for why this is a resource
# precondition rather than the `check` block it used to be.
# ENFORCED as a resource precondition, not a `check` block. A violated check emits
# `Warning: Check block assertion failed` and the plan EXITS 0 — measured on OpenTofu 1.12.3
# — so the comment above, which promised "a loud failure instead", described something that
# did not happen. A silent collector logging into a group nobody reads was exactly the
# outcome it was meant to prevent.
#
# `terraform_data` rather than a validation because the condition reads `local.*` and module
# outputs, which a variable validation cannot. It does not recreate the cycle the comment
# above describes: nothing references this resource, so it sits downstream of the services
# rather than inside the agent/service/log-group chain.
#
# `input` is bound to the guarded values so the precondition is re-evaluated whenever they
# change, rather than only on first create.
resource "terraform_data" "otel_agent_log_groups_match_services" {
  input = {
    api    = local.api_log_group
    worker = local.worker_log_group
  }

  lifecycle {
    precondition {
      condition     = local.api_log_group == module.api.log_group_name
      error_message = "api sidecar log group '${local.api_log_group}' != '${module.api.log_group_name}'. ecs-service changed its log-group naming; update local.api_log_group."
    }

    precondition {
      condition     = local.worker_log_group == module.worker.log_group_name
      error_message = "worker sidecar log group '${local.worker_log_group}' != '${module.worker.log_group_name}'. ecs-service changed its log-group naming; update local.worker_log_group."
    }
  }
}

# ── Guard: the pool arithmetic must fit the instance ──────────────────────────
# `local.api_pool_max` / `worker_pool_max` divide a connection budget by the
# AUTOSCALER'S CEILING, so the arithmetic only holds while both ceilings and the
# instance class stay in step. Raise `api.max_count` without touching anything
# else and the per-task pool shrinks to compensate — correct. Shrink the RDS
# class, though, and the budget moves under both. This asserts the invariant
# that matters: everything this stack can open at full scale-out still fits.
#
# Worth an assertion rather than a comment because the failure is invisible in a
# plan and indirect at runtime — requests stall for `connectionTimeoutMillis`
# rather than anything reporting "out of connections".
# ENFORCED as a resource precondition for the same reason as the log-group guard above: a
# `check` block only warns. The condition reads `local.*`, so a variable validation cannot
# express it.
resource "terraform_data" "db_pool_fits_instance_class" {
  input = {
    api    = var.api.max_count * local.api_pool_max
    worker = var.worker.max_count * local.worker_pool_max
    budget = local.db_pool_budget
  }

  lifecycle {
    precondition {
      condition = (var.api.max_count * local.api_pool_max
      + var.worker.max_count * local.worker_pool_max) <= local.db_pool_budget
      error_message = join(" ", [
        "DB pool ceiling exceeds the budget for ${var.rds.instance_class}:",
        "api ${var.api.max_count}x${local.api_pool_max}",
        "+ worker ${var.worker.max_count}x${local.worker_pool_max}",
        "> ${local.db_pool_budget} usable of ${local.db_max_connections}.",
        "Lower a max_count or move to a larger instance class.",
      ])
    }
  }
}

# ── RDS stop scheduler (optional) ─────────────────────────────────────────────
# The half that was missing. `_shared` grants the develop deploy role
# `rds:StartDBInstance` and qnsc-ci's deploy reusable wakes a stopped instance and
# restores services scaled to 0 — but nothing ever STOPPED anything. Only the waking
# side existed, and a comment claiming otherwise was once used to justify disabling a
# real outage alarm, so this is deliberately built rather than assumed.
#
# Two uses, one mechanism:
#   * production idled before go-live — AWS force-starts a stopped instance after
#     SEVEN DAYS, so without a recurring re-stop the saving silently evaporates and
#     nothing reports it.
#   * develop off-hours, if that is ever wanted — same resource, tighter cron.
#
# EventBridge Scheduler's universal target calls the RDS API directly: no Lambda to
# own, patch or pay for.
resource "aws_iam_role" "idler" {
  count = var.idle_schedule == null ? 0 : 1
  name  = "${local.name}-idler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Confused-deputy guard: without it any other account's schedule could assume
      # this role. Scoped to this account's schedules only.
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "idler" {
  count = var.idle_schedule == null ? 0 : 1
  name  = "idle-environment"
  role  = aws_iam_role.idler[0].id

  # Stop only. Not Start, and not Reboot: the schedule's whole job is to remove
  # capacity, and a role that can also start an instance turns a scheduling mistake
  # into a cost increase. Waking is the deploy pipeline's job and has its own grant.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StopDatabase"
        Effect   = "Allow"
        Action   = "rds:StopDBInstance"
        Resource = module.rds.instance_arn
      },
      {
        # Scaling to zero as well as stopping the database, because stopping only the
        # database leaves Fargate tasks running against an instance they cannot reach:
        # still billed, unable to serve, and noisy. `healthz` answers 200 regardless, so
        # the ALB keeps them registered and nothing reports the state.
        Sid    = "ScaleServicesToZero"
        Effect = "Allow"
        Action = "ecs:UpdateService"
        Resource = [
          module.api.service_arn,
          module.worker.service_arn,
        ]
      },
    ]
  })
}

resource "aws_scheduler_schedule" "rds_stop" {
  count       = var.idle_schedule == null ? 0 : 1
  name        = "${local.name}-rds-stop"
  description = "Stops ${module.rds.identifier}; see var.idle_schedule for why this exists"

  schedule_expression          = var.idle_schedule
  schedule_expression_timezone = "Asia/Ho_Chi_Minh"

  # OFF, not a window: this is not load-sensitive work, and an exact time makes the
  # relationship between a run and its CloudTrail entry unambiguous.
  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:stopDBInstance"
    role_arn = aws_iam_role.idler[0].arn
    input    = jsonencode({ DbInstanceIdentifier = module.rds.identifier })

    # No retries and no dead-letter queue ON PURPOSE. The common outcome is
    # InvalidDBInstanceState because the instance is ALREADY STOPPED — which is the
    # desired state, not an error. Retrying it would generate noise for a success, and
    # a DLQ would collect messages nobody should act on. A genuine permissions failure
    # still surfaces in CloudTrail and in the schedule's own metrics.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# ── Guard: an environment without a cache must run no tasks ───────────────────
# `cache.enabled = false` deletes the node, and ElastiCache has no stopped state, so
# this is the only way to stop an idled environment paying for one. But a task that
# cannot reach its cache does NOT fail loudly: `env.schema.ts` defaults REDIS_URL to
# localhost, and both the token denylist and the rate limiter FAIL OPEN when Valkey is
# unreachable. So the dangerous state is not "no cache" — it is "no cache, tasks
# running", which degrades two security controls silently.
#
# Enforced by a `validation` block on `var.cache` in variables.tf. It WAS a `check` here,
# and the comment claimed it made the combination "impossible to reach through Terraform:
# the plan fails". That was false — a violated check warns and the plan exits 0 — so the
# state that silently degrades two security controls would have applied cleanly. Waking an
# idled environment is one coherent change: cache back on, floors back to 1.


# Scale the services to zero on the same cadence as the database stop.
#
# `desired_count` is under `ignore_changes` in the ecs-service module, so setting it
# out of band is the sanctioned, non-drifting mechanism — which is why this uses
# ecs:UpdateService rather than an autoscaling scheduled action. A scheduled action
# would mutate the scalable target's min/max, and `aws_appautoscaling_target` has no
# `ignore_changes` on those, so every plan would show drift and any apply during the
# idle window would silently wake the environment.
#
# The floor being 0 (see api.min_count) is what makes this hold: with a floor of 1,
# Application Auto Scaling restores the service within minutes.
resource "aws_scheduler_schedule" "ecs_scale_down" {
  for_each = var.idle_schedule == null ? {} : {
    api    = module.api.service_name
    worker = module.worker.service_name
  }

  name        = "${local.name}-${each.key}-scale-down"
  description = "Scales ${each.value} to zero; see var.idle_schedule"

  schedule_expression          = var.idle_schedule
  schedule_expression_timezone = "Asia/Ho_Chi_Minh"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ecs:updateService"
    role_arn = aws_iam_role.idler[0].arn
    input = jsonencode({
      Cluster      = module.ecs_cluster.cluster_name
      Service      = each.value
      DesiredCount = 0
    })

    # Idempotent — scaling an already-zero service to zero succeeds — so unlike the RDS
    # stop this one has no expected-failure case. Retries stay off for consistency; a
    # missed run is corrected by the next tick.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# ── Waking (the reverse of idling) ────────────────────────────────────────────
# Starts the database and restores both services, on a cron. See var.wake_schedule
# for why this exists at all — the short version is that "the deploy pipeline is the
# wake signal" covers the days the environment is CHANGED but not the days it is
# merely USED, and RDS takes ~4-5 minutes to come up, so a person who finds it
# stopped cannot simply wait it out.
#
# A SEPARATE ROLE from the idler, which is the whole point. The idler's policy says
# in its own comment that it is stop-only because "a role that can also start an
# instance turns a scheduling mistake into a cost increase". That is still true, so
# the start grants live here instead of being added there: a fault in the wake cron
# can cost money, and a fault in the idle cron can cost availability, but neither
# can now cause the other.
resource "aws_iam_role" "waker" {
  count = var.wake_schedule == null ? 0 : 1
  name  = "${local.name}-waker"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Same confused-deputy guard as the idler.
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "waker" {
  count = var.wake_schedule == null ? 0 : 1
  name  = "wake-environment"
  role  = aws_iam_role.waker[0].id

  # Start only, mirroring the idler's stop-only. No rds:StopDBInstance here, and no
  # rds:DeleteDBInstance / RebootDBInstance — this role's entire job is to add
  # capacity back.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StartDatabase"
        Effect   = "Allow"
        Action   = "rds:StartDBInstance"
        Resource = module.rds.instance_arn
      },
      {
        Sid    = "RestoreServices"
        Effect = "Allow"
        Action = "ecs:UpdateService"
        Resource = [
          module.api.service_arn,
          module.worker.service_arn,
        ]
      },
    ]
  })
}

resource "aws_scheduler_schedule" "rds_start" {
  count       = var.wake_schedule == null ? 0 : 1
  name        = "${local.name}-rds-start"
  description = "Starts ${module.rds.identifier}; see var.wake_schedule for why this exists"

  schedule_expression          = var.wake_schedule
  schedule_expression_timezone = "Asia/Ho_Chi_Minh"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:startDBInstance"
    role_arn = aws_iam_role.waker[0].arn
    input    = jsonencode({ DbInstanceIdentifier = module.rds.identifier })

    # Mirror of the stop schedule: starting an already-started instance fails with
    # InvalidDBInstanceState, which is the DESIRED state and not an error. No retries
    # and no DLQ, for the same reason.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# Restore both services on the same cadence as the database start.
#
# DesiredCount is a literal 1, NOT var.api.min_count — see var.wake_schedule. The
# floors are 0 in an idled environment and have to stay 0, or Application Auto Scaling
# undoes the idle within minutes. 1 is the count the deploy pipeline sets, so a wake
# and a deploy agree.
#
# The tasks will come up before RDS finishes starting and will fail their readiness
# check for a few minutes. That is accepted: ECS keeps replacing them and they settle
# once postgres answers, which is the same behaviour a deploy-triggered wake already
# produces today. Sequencing the two would need a state machine, for a few minutes of
# 503 on a develop environment nobody is paged for.
resource "aws_scheduler_schedule" "ecs_scale_up" {
  for_each = var.wake_schedule == null ? {} : {
    api    = module.api.service_name
    worker = module.worker.service_name
  }

  name        = "${local.name}-${each.key}-scale-up"
  description = "Restores ${each.value} to 1 task; see var.wake_schedule"

  schedule_expression          = var.wake_schedule
  schedule_expression_timezone = "Asia/Ho_Chi_Minh"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ecs:updateService"
    role_arn = aws_iam_role.waker[0].arn
    input = jsonencode({
      Cluster      = module.ecs_cluster.cluster_name
      Service      = each.value
      DesiredCount = 1
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# ── Guard: waking an environment that never idles is a cost increase ──────────
# `wake_schedule` with no `idle_schedule` produces an environment that is started on a
# cron and never stopped by anything — strictly worse than not scheduling it at all,
# because it also looks deliberate. The reverse IS legitimate (production idles before
# go-live and is woken only by a release), so this is asserted in one direction only.


# ── Guard: a cache-less environment must not be woken ─────────────────────────
# The mirror of `idled_environment_runs_no_tasks` above. That check stops an idled
# environment from RUNNING tasks without a cache; this one stops a schedule being
# created that would START them. Without it the two settings are individually valid
# and jointly produce the exact state the other check exists to prevent — tasks up,
# no cache, REDIS_URL falling back to localhost, denylist and rate limiter failing
# open — except on a timer, at 08:00, with nobody watching.

