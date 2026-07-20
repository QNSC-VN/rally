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
    "db-url"               = "PostgreSQL connection URL for the app"
    "jwt-private"          = "EC P-256 (ES256) private key (PEM, base64-encoded)"
    "jwt-public"           = "EC P-256 (ES256) public key (PEM, base64-encoded)"
    "csrf-secret"          = "CSRF token signing secret"
    "entra-client-secret"  = "Microsoft Entra confidential-client secret (BFF OIDC)"
    "r2-access-key-id"     = "Cloudflare R2 bucket-scoped access key ID (attachments)"
    "r2-secret-access-key" = "Cloudflare R2 bucket-scoped secret access key (attachments)"
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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.3.0"

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

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
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

  cpu_target_pct     = 60 # tighter target in prod
  memory_target_pct  = 70
  log_retention_days = 90 # 90 days — SOC 2 minimum for prod logs

  tags = { Environment = local.env, Service = "api" }
}

# ── ECS Service — Worker ──────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.3.0"

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

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
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
    # Prod-safe: demo fixtures (ACME workspace, demo users/projects) must NEVER
    # be seeded into production. Explicit "false" (not omission) per audit D-3 so
    # the gate is structural. The migrator still runs migrations + system role
    # catalogue + tenant/SSO bootstrap on every deploy — see db/migrate.ts.
    SEED_ON_DEPLOY = "false"
    # Required by seed.ts to insert the SSO connection row that maps this Entra
    # directory to the system tenant. The insert is idempotent, so re-running on
    # each deploy is safe; without it, SSO login returns 401 on first prod boot.
    ENTRA_TENANT_ID = var.entra_tenant_id
  }

  secrets = {
    DATABASE_URL = module.secrets.secret_arns["db-url"]
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
