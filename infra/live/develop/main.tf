terraform {
  required_version = ">= 1.9"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.0" }
  }

  backend "s3" {
    bucket         = "qnsc-tofu-state"
    key            = "rally/develop/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    dynamodb_table = "qnsc-tofu-locks"
  }
}

provider "aws" {
  region = "ap-southeast-1"
  default_tags {
    tags = {
      Project     = "rally"
      Environment = "develop"
      ManagedBy   = "opentofu"
    }
  }
}

# Cloudflare provider — reads CLOUDFLARE_API_TOKEN from the environment
# (TF_VAR_cloudflare_api_token or the CLOUDFLARE_API_TOKEN env var). DNS
# records below are only created when cloudflare_zone_id is set, so this
# stack still applies cleanly before the token/zone are configured.
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

data "aws_caller_identity" "current" {}

# ── Read shared layer outputs (ECR URLs, KMS ARN, artifacts bucket) ───────────
# _shared owns ECR repos and re-exports platform-level outputs from qnsc-infra.
# Dependency: rally-infra/_shared must be applied before this environment stack.
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "rally/shared/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

locals {
  env    = "develop"
  name   = "rally-develop"
  region = "ap-southeast-1"
  azs    = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]

  # Public SPA/API hostname (Cloudflare-proxied). Single source of truth for the
  # dev domain — referenced by CORS_ORIGINS, APP_BASE_URL, ENTRA_REDIRECT_URI,
  # the S3 CORS allow-list and the Pages custom domain below.
  app_domain   = "rally-dev.qnsc.vn"
  app_base_url = "https://${local.app_domain}"

  kms_key_arn        = data.terraform_remote_state.shared.outputs.kms_key_arn
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")

  # Cloudflare IPv4 ranges — single source of truth in qnsc-infra bootstrap
  # (read via _shared remote state), so a CF range change is one edit there.
  # The API subdomain is Cloudflare-proxied (orange), so the ALB only ever sees
  # Cloudflare edge IPs — ingress is locked to these below.
  cloudflare_ipv4 = data.terraform_remote_state.shared.outputs.cloudflare_ipv4

  # ECR URLs derived from current AWS account — no hardcoded placeholder
  ecr_base         = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  ecr_api_url      = "${local.ecr_base}/rally-api:latest"
  ecr_worker_url   = "${local.ecr_base}/rally-worker:latest"
  ecr_migrator_url = "${local.ecr_base}/rally-migrator:latest"

  # Dev cache: a single small ElastiCache node shared by the api + worker tasks
  # (see aws_elasticache_cluster.cache below). Replaces the former per-task Valkey
  # sidecars, whose data died with the task on every deploy/recycle — evaporating
  # all BFF sessions (which live only in Valkey) and logging every user out. A
  # standalone node survives task replacement, so sessions persist across deploys,
  # matching prod (which consumes the shared runtime-prod cache node). Still one
  # small $ line item in dev, kept minimal via cache.t4g.micro + a single node.
  redis_url = "redis://${aws_elasticache_cluster.cache.cache_nodes[0].address}:6379"
}

# ── Shared runtime layer (VPC + NAT + ALB) ────────────────────────────────────
# Option A: the VPC/NAT/ALB now live once per env in qnsc-infra/live/runtime-dev
# and are shared by every product. This stack consumes them via remote state
# instead of creating its own. RDS + Fargate stay per-product below.
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/runtime-dev/terraform.tfstate"
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
    key    = "platform/storage-dev/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

# ── Secrets (scaffolding only — fill values in Secrets Manager console) ───────
module "secrets" {
  source      = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.0.0"
  prefix      = "rally/${local.env}"
  kms_key_arn = local.kms_key_arn

  # Dev: delete secrets immediately on teardown (no 7-day recovery window) so a
  # destroy+redeploy cycle doesn't hit "secret scheduled for deletion" on the
  # recreate. Prod keeps the default recovery window for safety.
  recovery_window_days = 0

  secret_names = {
    "jwt-private"         = "EC P-256 (ES256) private key (PEM, base64-encoded)"
    "jwt-public"          = "EC P-256 (ES256) public key (PEM, base64-encoded)"
    "csrf-secret"         = "CSRF token signing secret"
    "entra-client-secret" = "Microsoft Entra confidential-client secret (BFF OIDC)"
    # MUST be scoped to BOTH R2 buckets (<product>-<env>-attachments AND
    # <product>-<env>-public-assets). StorageService uses one S3 client for both,
    # so a token scoped to attachments alone makes every avatar/logo write 403.
    # R2 API tokens are minted by hand in the Cloudflare dashboard, not by
    # Terraform — re-mint with both buckets selected when adding a bucket.
    "r2-access-key-id"     = "Cloudflare R2 access key ID (attachments + public-assets)"
    "r2-secret-access-key" = "Cloudflare R2 secret access key (attachments + public-assets)"
  }

  tags = { Environment = local.env }
}

# ── RDS PostgreSQL 17 ─────────────────────────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v1.1.0"

  identifier        = local.name
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = "db.t4g.micro"
  allocated_storage_gb     = 20
  max_allocated_storage_gb = 100
  multi_az                 = false
  deletion_protection      = false # disable in staging for easy teardown
  backup_retention_days    = 3
  monitoring_interval      = 0 # disable Enhanced Monitoring in develop (saves CloudWatch cost)

  tags = { Environment = local.env }
}

# ── Cache (shared ElastiCache node) ───────────────────────────────────────────
# A single-node ElastiCache (Redis-compatible, Valkey-protocol) shared by the api
# and worker services. It lives OUTSIDE the ECS tasks so it survives task
# replacement — the root-cause fix for "users logged out on every dev deploy":
# BFF sessions are stored only in the cache, and the old per-task Valkey sidecars
# were destroyed with the task on each deploy. Reuses the cache SG + data subnets
# already provisioned by runtime-dev (sg_cache_id was created for exactly this).
resource "aws_elasticache_subnet_group" "cache" {
  name       = "${local.name}-cache"
  subnet_ids = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  tags       = { Environment = local.env }
}

resource "aws_elasticache_cluster" "cache" {
  cluster_id         = "${local.name}-cache"
  engine             = "redis"
  node_type          = "cache.t4g.micro" # smallest node — dev cost stays low
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.cache.name
  security_group_ids = [data.terraform_remote_state.runtime.outputs.sg_cache_id]
  apply_immediately  = true # dev: no maintenance-window wait
  tags               = { Environment = local.env }
}

# ── Messaging (SQS + SNS) ─────────────────────────────────────────────────────
module "messaging" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/messaging?ref=messaging-v1.0.0"
  prefix = local.name

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

  tags = { Environment = local.env }
}

# ── ALB ───────────────────────────────────────────────────────────────────────
# The ALB is shared and lives in runtime-dev. module.api attaches a host-header
# listener rule (rally-api-dev.qnsc.vn, priority 100) to its HTTPS listener.

# ── ECS Cluster ───────────────────────────────────────────────────────────────
module "ecs_cluster" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-cluster?ref=ecs-cluster-v1.0.0"
  name   = local.name
  tags   = { Environment = local.env }
}

# ── ECS Service — API ─────────────────────────────────────────────────────────
module "api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.4.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_api_url

  cpu    = 512
  memory = 1024

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = 3
  use_spot           = true # Fargate Spot: saves ~70% on compute in dev
  log_retention_days = 7    # dev: 7 days sufficient for debugging

  attach_alb        = true
  alb_listener_arn  = data.terraform_remote_state.runtime.outputs.https_listener_arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  alb_host_headers  = ["rally-api-dev.qnsc.vn"] # host-based routing on the shared ALB
  health_check_path = "/v1/healthz"

  # Cache is the shared ElastiCache node (aws_elasticache_cluster.cache), not an
  # in-task sidecar — so sessions in Valkey survive api deploys/recycles.

  # Includes the AWS-managed RDS secret: the execution role needs GetSecretValue
  # on it to inject DATABASE_USER/PASSWORD. Omit it and the task cannot start at
  # all ("unable to pull secrets") — it is not a runtime error, it is a boot
  # failure. The migrator reuses this role, so it is covered here too.
  secret_arns = concat(values(module.secrets.secret_arns), [module.rds.master_secret_arn])
  kms_key_arn = local.kms_key_arn
  secrets = [
    # Credentials come STRAIGHT from the RDS-managed secret that AWS owns and
    # rotates — never a hand-maintained copy. `:key::` selects one JSON field.
    #
    # This replaces a static `db-url` secret. That copy went stale on every
    # rotation and the next deploy died with 28P01 (auth failed for app_admin),
    # with nothing drifting in Terraform to explain why. Host/port/name are
    # non-secret and passed as plain env below; the app composes the URL.
    { name = "DATABASE_USER", secret_arn = "${module.rds.master_secret_arn}:username::" },
    { name = "DATABASE_PASSWORD", secret_arn = "${module.rds.master_secret_arn}:password::" },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    # Cloudflare R2 bucket-scoped credentials (S3-compatible SigV4).
    { name = "STORAGE_ACCESS_KEY_ID", secret_arn = module.secrets.secret_arns["r2-access-key-id"] },
    { name = "STORAGE_SECRET_ACCESS_KEY", secret_arn = module.secrets.secret_arns["r2-secret-access-key"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "REDIS_URL", value = local.redis_url }, # dev: shared ElastiCache node
    { name = "AWS_REGION", value = local.region },
    # Non-secret connection parts; DATABASE_USER/PASSWORD arrive via secrets.
    { name = "DATABASE_HOST", value = module.rds.address },
    { name = "DATABASE_PORT", value = tostring(module.rds.port) },
    { name = "DATABASE_NAME", value = module.rds.db_name },
    { name = "CORS_ORIGINS", value = local.app_base_url },
    { name = "APP_BASE_URL", value = local.app_base_url },
    # JWT config — defaults match app .env.example; override if needed
    { name = "JWT_ISSUER", value = "rally-api" },
    { name = "JWT_AUDIENCE", value = "rally-web" },
    { name = "JWT_ACCESS_EXPIRY", value = "15m" },
    { name = "JWT_REFRESH_EXPIRY", value = "30d" },
    # Microsoft Entra SSO (BFF) — all Entra vars are mandatory; the API fails to boot without them.
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "ENTRA_REDIRECT_URI", value = "${local.app_base_url}/v1/bff/callback" },
    # Multi-IdP broker: the home (company Entra) connection resolves its client
    # secret at RUNTIME from this ref. Reuses entra-client-secret (same Entra
    # app) — no duplicate copy to drift on rotation. Unset leaves the broker
    # home path dormant (legacy GET /bff/login unaffected). The task role is
    # granted GetSecretValue on it via task_secret_arns below.
    { name = "IDENTITY_HOME_SECRET_REF", value = module.secrets.secret_arns["entra-client-secret"] },
    # Comma-separated emails auto-granted workspace_admin on every SSO login
    { name = "PLATFORM_ADMIN_EMAILS", value = "nghiavt@qnsc.vn,quangld@qnsc.vn,hieuvbm@qnsc.vn,anhntn@qnsc.vn" },
    # Messaging — SQS queue URLs injected at deploy time from module outputs
    { name = "SQS_NOTIFICATIONS_URL", value = module.messaging.queue_urls["notifications"] },
    { name = "SQS_AUDIT_URL", value = module.messaging.queue_urls["audit"] },
    { name = "SQS_REPORTING_URL", value = module.messaging.queue_urls["reporting"] },
    { name = "SQS_SEARCH_URL", value = module.messaging.queue_urls["search"] },
    { name = "SNS_TOPIC_ARN", value = module.messaging.topic_arns["domain-events"] },
    # Attachments object storage — Cloudflare R2 (S3-compatible) from the platform
    # storage-dev stack. Bucket name still travels as S3_ATTACHMENTS_BUCKET; the
    # presence of STORAGE_ENDPOINT flips StorageService to the R2 endpoint + keys.
    { name = "S3_ATTACHMENTS_BUCKET", value = data.terraform_remote_state.storage.outputs.rally_attachments_name },
    # Separate PUBLIC bucket for avatars/logos. StorageService refuses to store a
    # public asset when this is unset rather than falling back to the private
    # bucket — a silent fallback would put world-readable objects next to
    # permission-gated ones.
    { name = "S3_PUBLIC_ASSETS_BUCKET", value = data.terraform_remote_state.storage.outputs.rally_public_assets_name },
    # CDN_PUBLIC_ASSETS_BASE_URL is deliberately NOT set yet — the public bucket
    # has no custom domain until cf-r2-v1.1.0 ships. Unset means public assets
    # fall back to a presigned GET, which is correct, just not edge-cached.
    # When wiring it: source it from the storage stack output, never hand-enter
    # it, and never point it at the attachments bucket.
    { name = "STORAGE_ENDPOINT", value = data.terraform_remote_state.storage.outputs.rally_attachments_endpoint },
    { name = "STORAGE_FORCE_PATH_STYLE", value = "true" },
    # Email — SES in production
    { name = "EMAIL_PROVIDER", value = "ses" },
    # Observability
    { name = "LOG_LEVEL", value = "info" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "OTEL_ENABLED", value = "false" },
    { name = "OTEL_SERVICE_NAME", value = "rally-api" },
  ]

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)

  # Multi-IdP broker: the TASK role reads per-connection OIDC client secrets at
  # RUNTIME (resolved from the sso_connections row on demand). The home
  # connection reuses entra-client-secret; the sso/* prefix covers future
  # vendor connections added out-of-band (create the secret + the DB row, no TF
  # change). Distinct from secret_arns above (execution role, boot-time inject).
  task_secret_arns = [
    module.secrets.secret_arns["entra-client-secret"],
    "arn:aws:secretsmanager:${local.region}:${data.aws_caller_identity.current.account_id}:secret:rally/${local.env}/sso/*",
  ]

  tags = { Environment = local.env, Service = "api" }
}

# ── ECS Service — Worker ──────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.4.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_worker_url

  cpu    = 256
  memory = 512

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count      = 1
  min_count          = 1
  max_count          = 2
  use_spot           = true # Fargate Spot: saves ~70% on compute in dev
  log_retention_days = 7    # dev: 7 days sufficient for debugging

  attach_alb = false

  # Worker has no HTTP listener — check the node process is alive instead
  health_check_command = "pgrep -x node || exit 1"
  container_port       = 3001

  # Cache is the shared ElastiCache node (aws_elasticache_cluster.cache) — the
  # worker and api now share one cache, so their Redis pub/sub (notification
  # wake-ups) actually connects across tasks instead of each hitting its own
  # isolated sidecar.

  # Includes the AWS-managed RDS secret: the execution role needs GetSecretValue
  # on it to inject DATABASE_USER/PASSWORD. Omit it and the task cannot start at
  # all ("unable to pull secrets") — it is not a runtime error, it is a boot
  # failure. The migrator reuses this role, so it is covered here too.
  secret_arns = concat(values(module.secrets.secret_arns), [module.rds.master_secret_arn])
  kms_key_arn = local.kms_key_arn
  secrets = [
    # Credentials come STRAIGHT from the RDS-managed secret that AWS owns and
    # rotates — never a hand-maintained copy. `:key::` selects one JSON field.
    #
    # This replaces a static `db-url` secret. That copy went stale on every
    # rotation and the next deploy died with 28P01 (auth failed for app_admin),
    # with nothing drifting in Terraform to explain why. Host/port/name are
    # non-secret and passed as plain env below; the app composes the URL.
    { name = "DATABASE_USER", secret_arn = "${module.rds.master_secret_arn}:username::" },
    { name = "DATABASE_PASSWORD", secret_arn = "${module.rds.master_secret_arn}:password::" },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
    # Shared schema requires CSRF_SECRET even though the worker never uses it as middleware
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
    # Shared schema also validates the Entra client secret at boot (worker runs the same env schema).
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    # Cloudflare R2 bucket-scoped credentials (worker also reads/writes attachments).
    { name = "STORAGE_ACCESS_KEY_ID", secret_arn = module.secrets.secret_arns["r2-access-key-id"] },
    { name = "STORAGE_SECRET_ACCESS_KEY", secret_arn = module.secrets.secret_arns["r2-secret-access-key"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_URL", value = local.redis_url }, # dev: shared ElastiCache node
    { name = "AWS_REGION", value = local.region },
    # Non-secret connection parts; DATABASE_USER/PASSWORD arrive via secrets.
    { name = "DATABASE_HOST", value = module.rds.address },
    { name = "DATABASE_PORT", value = tostring(module.rds.port) },
    { name = "DATABASE_NAME", value = module.rds.db_name },
    # Entra SSO — the worker validates the shared env schema, so these are required to boot.
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    { name = "ENTRA_REDIRECT_URI", value = "${local.app_base_url}/v1/bff/callback" },
    { name = "SQS_NOTIFICATIONS_URL", value = module.messaging.queue_urls["notifications"] },
    { name = "SQS_AUDIT_URL", value = module.messaging.queue_urls["audit"] },
    { name = "SQS_REPORTING_URL", value = module.messaging.queue_urls["reporting"] },
    { name = "SQS_SEARCH_URL", value = module.messaging.queue_urls["search"] },
    { name = "SNS_TOPIC_ARN", value = module.messaging.topic_arns["domain-events"] },
    # Attachments object storage — Cloudflare R2 (see api service for rationale).
    { name = "S3_ATTACHMENTS_BUCKET", value = data.terraform_remote_state.storage.outputs.rally_attachments_name },
    # Separate PUBLIC bucket for avatars/logos. StorageService refuses to store a
    # public asset when this is unset rather than falling back to the private
    # bucket — a silent fallback would put world-readable objects next to
    # permission-gated ones.
    { name = "S3_PUBLIC_ASSETS_BUCKET", value = data.terraform_remote_state.storage.outputs.rally_public_assets_name },
    # CDN_PUBLIC_ASSETS_BASE_URL is deliberately NOT set yet — the public bucket
    # has no custom domain until cf-r2-v1.1.0 ships. Unset means public assets
    # fall back to a presigned GET, which is correct, just not edge-cached.
    # When wiring it: source it from the storage stack output, never hand-enter
    # it, and never point it at the attachments bucket.
    { name = "STORAGE_ENDPOINT", value = data.terraform_remote_state.storage.outputs.rally_attachments_endpoint },
    { name = "STORAGE_FORCE_PATH_STYLE", value = "true" },
    { name = "EMAIL_PROVIDER", value = "ses" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "OTEL_ENABLED", value = "false" },
    { name = "OTEL_SERVICE_NAME", value = "rally-worker" },
  ]

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)

  tags = { Environment = local.env, Service = "worker" }
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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/oneshot-task?ref=oneshot-task-v1.0.0"

  name               = "${local.name}-migrator"
  container_name     = "migrator"
  image              = local.ecr_migrator_url
  cpu                = 512
  memory             = 1024
  execution_role_arn = module.api.execution_role_arn
  task_role_arn      = module.api.task_role_arn
  region             = local.region
  log_retention_days = 7 # dev: keep only 7 days (migrator is a one-shot task)

  environment = {
    NODE_ENV       = "production"
    AWS_REGION     = local.region
    SEED_ON_DEPLOY = "true"
    # Non-secret connection parts; USER/PASSWORD arrive via secrets below.
    DATABASE_HOST = module.rds.address
    DATABASE_PORT = tostring(module.rds.port)
    DATABASE_NAME = module.rds.db_name
    # Required by seed.ts to insert the SSO connection row that maps
    # this Entra directory to the system tenant (acme).
    # Without it, the ssoConnections insert is skipped and SSO login returns 401.
    ENTRA_TENANT_ID = var.entra_tenant_id
  }

  secrets = {
    # Same RDS-managed credential as the services — the master user holds full
    # DDL rights. Read live from the AWS-managed secret so a rotation can never
    # leave the migrator holding a stale password.
    DATABASE_USER     = "${module.rds.master_secret_arn}:username::"
    DATABASE_PASSWORD = "${module.rds.master_secret_arn}:password::"
  }

  tags = { Environment = local.env, Service = "migrator" }
}

# ── WAF: not used in dev. In prod the WebACL lives in runtime-prod and is
# associated with the shared ALB there. ───────────────────────────────────────

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Replaces the deprecated S3 + CloudFront (cdn) stack. Content is deployed from
# CI with `wrangler pages deploy apps/web/dist`. The SPA is built with an empty
# VITE_API_URL, so it reaches the API through relative /v1/* paths that the
# Pages Function reverse-proxy (apps/web/functions/v1/[[path]].ts) forwards to
# API_ORIGIN. That keeps the SPA and API same-origin under rally-dev.qnsc.vn —
# required so the BFF __Host- session cookie is honoured (no cross-site cookie,
# no CORS). Pages provisions the project + custom domain + proxied CNAME. Gated
# on cloudflare_account_id so the stack still applies before the CF account is
# wired.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.0"

  account_id  = var.cloudflare_account_id
  name        = "rally-develop-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? local.app_domain : ""
  record_name = local.cloudflare_zone_id != "" ? "rally-dev" : ""
  comment     = "rally-develop web SPA → Cloudflare Pages (managed by rally-infra develop)"

  # Pages Function proxy upstream: /v1/* (incl. /v1/bff/*) is forwarded here so
  # the browser only ever sees the SPA origin (same-origin BFF requirement).
  production_env_vars = {
    API_ORIGIN = "https://rally-api-dev.qnsc.vn"
  }
}

# ── DNS — rally-api-dev.qnsc.vn → ALB (Cloudflare-proxied edge) ──────────────
# The API's public edge. Cloudflare-proxied (orange cloud) so the ALB is never
# directly reachable — WAF/DDoS/TLS terminate at Cloudflare, and the ALB SG is
# locked to cloudflare_ipv4 above. Cloudflare→origin runs in Full (strict) SSL
# mode; the ALB HTTPS listener serves the *.qnsc.vn cert, which matches the SNI
# rally-api-dev.qnsc.vn. The api ECS service already attaches its /* forward
# rule to that HTTPS listener (see module.api.alb_listener_arn).
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.1.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = "rally-api-dev"
  type    = "CNAME"
  content = data.terraform_remote_state.runtime.outputs.alb_dns_name
  proxied = true # orange cloud: shield the ALB, edge WAF/DDoS at Cloudflare
  comment = "rally-develop API → ALB via Cloudflare proxy (managed by rally-infra develop)"
}

