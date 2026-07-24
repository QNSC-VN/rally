terraform {
  required_version = ">= 1.9"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.0" }
  }

  backend "s3" {
    bucket         = "qnsc-tofu-state"
    key            = "rally/prod/terraform.tfstate"
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
      Environment = "production"
      ManagedBy   = "opentofu"
    }
  }
}

# Cloudflare provider — see develop stack for rationale. DNS record created
# only when cloudflare_zone_id is set, so this stack applies before DNS wiring.
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

data "aws_caller_identity" "current" {}

# ── Read shared layer outputs (ECR URLs, KMS ARN, artifacts bucket) ─────────────
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "rally/shared/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

locals {
  env    = "production"
  name   = "rally-prod"
  region = "ap-southeast-1"
  azs    = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]

  # Public hostnames (Cloudflare-proxied). Single source of truth for the prod
  # domain — referenced by CORS_ORIGINS, APP_BASE_URL, ENTRA_REDIRECT_URI, the
  # S3 CORS allow-list, the API host-header rule, the API DNS record and the
  # Pages custom domain below.
  app_domain   = "rally.qnsc.vn"
  app_base_url = "https://${local.app_domain}"
  api_domain   = "rally-api.qnsc.vn"
  api_record   = "rally-api" # subdomain label for the Cloudflare CNAME

  kms_key_arn        = data.terraform_remote_state.shared.outputs.kms_key_arn
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")

  ecr_base         = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  ecr_api_url      = "${local.ecr_base}/rally-api:${var.image_tag}"
  ecr_worker_url   = "${local.ecr_base}/rally-worker:${var.image_tag}"
  ecr_migrator_url = "${local.ecr_base}/rally-migrator:${var.image_tag}"

  # Cloudflare IPv4 ranges — single source of truth in qnsc-infra bootstrap
  # (read via _shared remote state), so a CF range change is one edit there.
  cloudflare_ipv4 = data.terraform_remote_state.shared.outputs.cloudflare_ipv4

  # Cache endpoint: this product's own dedicated Valkey node (module.cache below).
  # The cache module enables in-transit encryption, so the client connects over
  # TLS (rediss://). REDIS_URL is an env var (not a secret) — the endpoint isn't
  # sensitive.
  cache_endpoint = module.cache.endpoint
  cache_port     = module.cache.port
  redis_url      = "rediss://${local.cache_endpoint}:${local.cache_port}"
}

# ── Shared runtime layer (VPC + NAT + ALB + WAF) ──────────────────────────────
# The prod VPC/NAT/ALB/WAF live once per env in qnsc-infra/live/runtime-prod and
# are consumed here via remote state. RDS + cache + Fargate stay per-product
# below.
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/runtime-prod/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

# ── Object storage layer (Cloudflare R2 attachment bucket) ─────────────────
# Attachments live in the platform storage-prod stack (v5 Cloudflare provider,
# isolated from this v4 stack). We consume its name + S3-compatible endpoint via
# remote state — no Cloudflare provider or R2 resource here. Bucket-scoped runtime
# credentials come from Secrets Manager (r2-* below).
# Dependency: platform/storage-prod must be applied before this environment stack.
data "terraform_remote_state" "storage" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/storage-prod/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

# ── Secrets ─────────────────────────────────────────────────────────────────────
module "secrets" {
  source               = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.0.0"
  prefix               = "rally/${local.env}"
  kms_key_arn          = local.kms_key_arn
  recovery_window_days = 30 # longer recovery in production

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

# ── RDS PostgreSQL 17 (Multi-AZ) ─────────────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v1.1.0"

  identifier        = local.name
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = "db.t4g.micro"
  allocated_storage_gb     = 100
  max_allocated_storage_gb = 500
  multi_az                 = false
  deletion_protection      = true
  backup_retention_days    = 30
  monitoring_interval      = 0

  tags = { Environment = local.env }
}

# ── Cache (dedicated per-product Valkey node) ────────────────────────────────
# This product owns its own single-node ElastiCache Valkey so another product's
# load or a node restart can't evict rally's BFF sessions. In-transit + at-rest
# encryption on (SOC 2); reuses the shared runtime-prod cache SG + data subnets.
# Endpoint feeds local.redis_url (rediss://) above.
module "cache" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = "${local.name}-cache"
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_cache_id
  kms_key_arn       = local.kms_key_arn

  mode      = "node" # single cache.t4g.micro (~$12/mo) — cheaper than serverless ~$90 floor
  node_type = "cache.t4g.micro"

  tags = { Environment = local.env }
}

# ── Messaging ─────────────────────────────────────────────────────────────────
module "messaging" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/messaging?ref=messaging-v1.0.0"

  prefix                = local.name
  dlq_max_receive_count = 3 # move to DLQ faster in production

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

# ── ALB: shared, lives in runtime-prod (with access logs + WAF). This stack
# attaches host-header listener rules (module.api) to its HTTPS listener. ──────

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

  cpu    = 1024
  memory = 2048

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count = 1
  min_count     = 1
  max_count     = 10

  attach_alb        = true
  alb_listener_arn  = data.terraform_remote_state.runtime.outputs.https_listener_arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  alb_host_headers  = [local.api_domain] # host-based routing on the shared prod ALB
  health_check_path = "/v1/healthz"

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
    { name = "REDIS_URL", value = local.redis_url }, # shared runtime-prod cache
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
    # Microsoft Entra SSO (BFF) — mandatory; the API fails to boot without them.
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
    # storage-prod stack. Bucket name still travels as S3_ATTACHMENTS_BUCKET; the
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

  cpu_target_pct     = 60 # tighter target in prod
  memory_target_pct  = 70
  log_retention_days = 90 # 90 days — SOC 2 minimum for prod logs

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

  cpu    = 512
  memory = 1024

  vpc_id            = data.terraform_remote_state.runtime.outputs.vpc_id
  subnet_ids        = data.terraform_remote_state.runtime.outputs.private_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_app_id

  desired_count = 1
  min_count     = 1
  max_count     = 6

  attach_alb = false

  # Worker has no HTTP listener — check the node process is alive instead
  health_check_command = "pgrep -x node || exit 1"
  container_port       = 3001

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
    # Shared env schema validates these at boot even though the worker never uses them as middleware.
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
    { name = "ENTRA_CLIENT_SECRET", secret_arn = module.secrets.secret_arns["entra-client-secret"] },
    # Cloudflare R2 bucket-scoped credentials (worker also reads/writes attachments).
    { name = "STORAGE_ACCESS_KEY_ID", secret_arn = module.secrets.secret_arns["r2-access-key-id"] },
    { name = "STORAGE_SECRET_ACCESS_KEY", secret_arn = module.secrets.secret_arns["r2-secret-access-key"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_URL", value = local.redis_url },
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

  sqs_queue_arns     = values(module.messaging.queue_arns)
  sns_topic_arns     = values(module.messaging.topic_arns)
  log_retention_days = 90

  tags = { Environment = local.env, Service = "worker" }
}

# Attachments object storage lives entirely in Cloudflare R2 (platform
# storage-prod stack; see the api/worker STORAGE_* wiring and the storage remote
# state above). Prod launches R2-native — there is no transitional S3 rollback
# bucket: this environment is greenfield (no pre-existing attachment data to roll
# back to) and the R2 path was verified end-to-end in develop first. This keeps
# dev/prod parity (develop has no app_bucket either).

# ── Migrator (one-shot, run by the deploy pipeline before the service update) ─
# Runs `pnpm migration:run` then exits. Never scheduled as a service; the
# backend deploy triggers it with aws ecs run-task before rolling the API.
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
  log_retention_days = 90 # prod: SOC 2 minimum retention

  environment = {
    NODE_ENV   = "production"
    AWS_REGION = local.region
    # Non-secret connection parts; USER/PASSWORD arrive via secrets below.
    DATABASE_HOST = module.rds.address
    DATABASE_PORT = tostring(module.rds.port)
    DATABASE_NAME = module.rds.db_name
    # Prod-safe: demo fixtures (ACME workspace, demo users/projects) must NEVER
    # be seeded into production. Explicit "false" (not omission) per audit D-3 so
    # the gate is structural. The migrator still runs migrations + system role
    # catalogue + tenant/SSO bootstrap on every deploy — see db/migrate.ts.
    SEED_ON_DEPLOY = "false"
    # Required by seed.ts to insert the SSO connection row that maps this Entra
    # directory to the system tenant. The insert is idempotent, so re-running on
    # each deploy is safe; without it, SSO login returns 401 on first prod boot.
    ENTRA_TENANT_ID = var.entra_tenant_id
    # Broker home connection (identity >= 5.5.0): the seed writes clientId +
    # clientSecretRef onto the home sso_connections row. Without these it seeds
    # null refs and broker home login can't run the confidential-client token
    # exchange. clientSecretRef is a REF (ARN) only — not read at seed time, so
    # no task-role change here (the migrator already reuses module.api's role).
    ENTRA_CLIENT_ID          = var.entra_client_id
    IDENTITY_HOME_SECRET_REF = module.secrets.secret_arns["entra-client-secret"]
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

# ── WAF: lives in runtime-prod and is associated with the shared ALB there. ──

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Consistent with rally develop + opshub. Cloudflare's global edge replaces the
# CloudFront PriceClass_All coverage. The Pages project + custom domain + proxied
# CNAME are created once the Cloudflare account is wired (gated on
# cloudflare_account_id); the public hostname is local.app_domain.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.0"

  account_id  = var.cloudflare_account_id
  name        = "rally-prod-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? local.app_domain : ""
  record_name = local.cloudflare_zone_id != "" ? "rally" : ""
  comment     = "rally-prod web SPA → Cloudflare Pages (managed by rally-infra prod)"

  # Pages Function proxy upstream: /v1/* (incl. /v1/bff/*) is forwarded here so
  # the browser only ever sees the SPA origin (same-origin BFF requirement).
  production_env_vars = {
    API_ORIGIN = "https://${local.api_domain}"
  }
}

# ── DNS — rally-api.qnsc.vn → ALB (Cloudflare-proxied edge) ──────────────────
# The API's public edge. Cloudflare-proxied (orange cloud) so the shared ALB is
# never directly reachable — WAF/DDoS/TLS terminate at Cloudflare, and the ALB
# SG is locked to cloudflare_ipv4. Cloudflare→origin runs Full (strict); the ALB
# HTTPS listener serves the *.qnsc.vn cert, matching the SNI rally-api.qnsc.vn.
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.1.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = local.api_record
  type    = "CNAME"
  content = data.terraform_remote_state.runtime.outputs.alb_dns_name
  proxied = true # orange cloud: shield the ALB, edge WAF/DDoS at Cloudflare
  comment = "rally-prod API → ALB via Cloudflare proxy (managed by rally-infra prod)"
}
