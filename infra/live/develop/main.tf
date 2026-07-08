terraform {
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

  kms_key_arn        = data.terraform_remote_state.shared.outputs.kms_key_arn
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")

  # Deployment mode — coalesce empty (unset GitHub repo var) → app defaults.
  deployment_mode    = var.deployment_mode != "" ? var.deployment_mode : "saas"
  single_tenant_name = var.single_tenant_name != "" ? var.single_tenant_name : "Default Organization"
  single_tenant_slug = var.single_tenant_slug != "" ? var.single_tenant_slug : "default"

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

  # Dev cache: a Valkey sidecar per task (localhost:6379) instead of a shared
  # ElastiCache node — $0 in dev. Each task gets its own in-task instance
  # (accepted dev tradeoff); prod uses the shared runtime-prod cache node.
  valkey_sidecar = {
    name         = "valkey"
    image        = "valkey/valkey:8-alpine"
    essential    = false
    portMappings = [{ containerPort = 6379, protocol = "tcp" }]
    environment  = []
  }
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
    "db-url"      = "PostgreSQL connection URL for the app"
    "jwt-private" = "Ed25519 private key (PEM, base64-encoded)"
    "jwt-public"  = "Ed25519 public key (PEM, base64-encoded)"
    "csrf-secret" = "CSRF token signing secret"
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

  tags = { Environment = local.env, AutoStop = "true" }
}

# ── Cache ─────────────────────────────────────────────────────────────────────
# Dev has no ElastiCache node — each Fargate task runs a Valkey sidecar at
# localhost:6379 (see local.valkey_sidecar, wired into module.api/worker).

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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.2.0"

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

  # Dev Valkey sidecar (localhost:6379) — replaces the ElastiCache node.
  additional_containers = [local.valkey_sidecar]

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "REDIS_URL", value = "redis://localhost:6379" }, # dev: Valkey sidecar
    { name = "AWS_REGION", value = local.region },
    { name = "CORS_ORIGINS", value = "https://rally-dev.qnsc.vn" },
    { name = "APP_BASE_URL", value = "https://rally-dev.qnsc.vn" },
    # JWT config — defaults match app .env.example; override if needed
    { name = "JWT_ISSUER", value = "rally-api" },
    { name = "JWT_AUDIENCE", value = "rally-web" },
    { name = "JWT_ACCESS_EXPIRY", value = "15m" },
    { name = "JWT_REFRESH_EXPIRY", value = "30d" },
    # Microsoft Entra SSO — set tenant/client IDs; leave empty to disable SSO
    { name = "ENTRA_TENANT_ID", value = var.entra_tenant_id },
    { name = "ENTRA_CLIENT_ID", value = var.entra_client_id },
    # Comma-separated emails auto-granted workspace_admin on every SSO login
    { name = "PLATFORM_ADMIN_EMAILS", value = "nghiavt18@qnsc.vn,quangld@qnsc.vn,hieuvbm@qnsc.vn,anhntn@qnsc.vn" },
    # Deployment mode — 'saas' = multi-tenant (self-serve signup on); 'single' =
    # packaged per customer (one tenant, signup off). Dev is normally 'saas';
    # set via the RALLY_*_DEVELOP repo vars, empty falls back to 'saas'.
    { name = "DEPLOYMENT_MODE", value = local.deployment_mode },
    { name = "SINGLE_TENANT_NAME", value = local.single_tenant_name },
    { name = "SINGLE_TENANT_SLUG", value = local.single_tenant_slug },
    # Messaging — SQS queue URLs injected at deploy time from module outputs
    { name = "SQS_NOTIFICATIONS_URL", value = module.messaging.queue_urls["notifications"] },
    { name = "SQS_AUDIT_URL", value = module.messaging.queue_urls["audit"] },
    { name = "SQS_REPORTING_URL", value = module.messaging.queue_urls["reporting"] },
    { name = "SQS_SEARCH_URL", value = module.messaging.queue_urls["search"] },
    { name = "SNS_TOPIC_ARN", value = module.messaging.topic_arns["domain-events"] },
    # S3 attachments bucket
    { name = "S3_ATTACHMENTS_BUCKET", value = module.app_bucket.bucket },
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

  tags = { Environment = local.env, Service = "api", AutoStop = "true" }
}

# ── ECS Service — Worker ──────────────────────────────────────────────────────
module "worker" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.2.0"

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

  # Dev Valkey sidecar (localhost:6379) — worker has its own in-task cache.
  additional_containers = [local.valkey_sidecar]

  secret_arns = values(module.secrets.secret_arns)
  kms_key_arn = local.kms_key_arn
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
    # Shared schema requires CSRF_SECRET even though the worker never uses it as middleware
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_URL", value = "redis://localhost:6379" }, # dev: Valkey sidecar
    { name = "AWS_REGION", value = local.region },
    { name = "SQS_NOTIFICATIONS_URL", value = module.messaging.queue_urls["notifications"] },
    { name = "SQS_AUDIT_URL", value = module.messaging.queue_urls["audit"] },
    { name = "SQS_REPORTING_URL", value = module.messaging.queue_urls["reporting"] },
    { name = "SQS_SEARCH_URL", value = module.messaging.queue_urls["search"] },
    { name = "SNS_TOPIC_ARN", value = module.messaging.topic_arns["domain-events"] },
    { name = "S3_ATTACHMENTS_BUCKET", value = module.app_bucket.bucket },
    { name = "EMAIL_PROVIDER", value = "ses" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "LOG_PRETTY", value = "false" },
    { name = "OTEL_ENABLED", value = "false" },
    { name = "OTEL_SERVICE_NAME", value = "rally-worker" },
  ]

  sqs_queue_arns = values(module.messaging.queue_arns)
  sns_topic_arns = values(module.messaging.topic_arns)

  tags = { Environment = local.env, Service = "worker", AutoStop = "true" }
}

# ── S3 — Attachments bucket ───────────────────────────────────────────────────
module "app_bucket" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/app-bucket?ref=app-bucket-v1.0.0"

  name          = "${local.name}-attachments"
  kms_key_arn   = local.kms_key_arn
  force_destroy = true # dev: attachments are ephemeral, allow clean teardown

  cors_rules = [{
    allowed_headers = ["Content-Type", "Content-Disposition"]
    allowed_methods = ["PUT"]
    allowed_origins = ["https://rally-dev.qnsc.vn", "http://localhost:5173"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }]

  tags = { Environment = local.env }
}

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
    # Required by seed.ts to insert the SSO connection row that maps
    # this Entra directory to the system tenant (acme).
    # Without it, the ssoConnections insert is skipped and SSO login returns 401.
    ENTRA_TENANT_ID = var.entra_tenant_id
  }

  secrets = {
    # The migrator uses the same DATABASE_URL (rallyadmin has full DDL rights)
    DATABASE_URL = module.secrets.secret_arns["db-url"]
  }

  tags = { Environment = local.env, Service = "migrator" }
}

# ── WAF: not used in dev. In prod the WebACL lives in runtime-prod and is
# associated with the shared ALB there. ───────────────────────────────────────

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Replaces the deprecated S3 + CloudFront (cdn) stack. Content is deployed from
# CI with `wrangler pages deploy apps/web/dist`. The API has its own edge — the
# SPA calls https://rally-api-dev.qnsc.vn directly (VITE_API_URL baked at build
# time), which is Cloudflare-proxied → ALB. Same-site under qnsc.vn, so cookies
# + CORS work cleanly. Pages provisions the project + custom domain + proxied
# CNAME. Gated on cloudflare_account_id so the stack still applies before the
# Cloudflare account is wired.
module "web" {
  count  = var.cloudflare_account_id != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.0"

  account_id  = var.cloudflare_account_id
  name        = "rally-develop-web"
  zone_id     = local.cloudflare_zone_id
  domain      = local.cloudflare_zone_id != "" ? "rally-dev.qnsc.vn" : ""
  record_name = local.cloudflare_zone_id != "" ? "rally-dev" : ""
  comment     = "rally-develop web SPA → Cloudflare Pages (managed by rally-infra develop)"
}

# ── DNS — rally-api-dev.qnsc.vn → ALB (Cloudflare-proxied edge) ──────────────
# The API's public edge. Cloudflare-proxied (orange cloud) so the ALB is never
# directly reachable — WAF/DDoS/TLS terminate at Cloudflare, and the ALB SG is
# locked to cloudflare_ipv4 above. Cloudflare→origin runs in Full (strict) SSL
# mode; the ALB HTTPS listener serves the *.qnsc.vn cert, which matches the SNI
# rally-api-dev.qnsc.vn. The api ECS service already attaches its /* forward
# rule to that HTTPS listener (see module.api.alb_listener_arn).
module "dns_api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dns-record?ref=dns-record-v1.0.0"

  enabled = local.cloudflare_zone_id != ""
  zone_id = local.cloudflare_zone_id
  name    = "rally-api-dev"
  type    = "CNAME"
  content = data.terraform_remote_state.runtime.outputs.alb_dns_name
  proxied = true # orange cloud: shield the ALB, edge WAF/DDoS at Cloudflare
  comment = "rally-develop API → ALB via Cloudflare proxy (managed by rally-infra develop)"
}

# ── Dev cost saver: stop RDS + scale ECS to 0 off-hours ───────────────────────
# Acts on resources tagged AutoStop=true (rds, api, worker above).
module "dev_scheduler" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/dev-scheduler?ref=dev-scheduler-v1.1.0"
  name   = local.name
  tags   = { Environment = local.env }
}

