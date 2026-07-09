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

  kms_key_arn        = data.terraform_remote_state.shared.outputs.kms_key_arn
  cloudflare_zone_id = try(data.terraform_remote_state.shared.outputs.cloudflare_zone_id, "")

  # Deployment mode — coalesce empty (unset GitHub repo var) → app defaults.
  deployment_mode    = var.deployment_mode != "" ? var.deployment_mode : "saas"
  single_tenant_name = var.single_tenant_name != "" ? var.single_tenant_name : "Default Organization"
  single_tenant_slug = var.single_tenant_slug != "" ? var.single_tenant_slug : "default"

  ecr_base       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  ecr_api_url    = "${local.ecr_base}/rally-api:${var.image_tag}"
  ecr_worker_url = "${local.ecr_base}/rally-worker:${var.image_tag}"

  # Cloudflare IPv4 ranges — single source of truth in qnsc-infra bootstrap
  # (read via _shared remote state), so a CF range change is one edit there.
  cloudflare_ipv4 = data.terraform_remote_state.shared.outputs.cloudflare_ipv4

  # prod_tier switch (Option A): lean = shared runtime-prod cache + single-AZ
  # DB + 1 task/svc; ha = per-product cache + multi-AZ DB + 2 tasks/svc.
  is_ha = var.prod_tier == "ha"

  # Cache endpoint: lean uses the shared runtime-prod node (via remote state);
  # ha uses this product's own cache node (module.cache below). REDIS_URL is an
  # env var (not a secret) — the endpoint isn't sensitive.
  cache_endpoint = coalesce(one(module.cache[*].endpoint), data.terraform_remote_state.runtime.outputs.cache_endpoint)
  cache_port     = coalesce(one(module.cache[*].port), data.terraform_remote_state.runtime.outputs.cache_port)
  redis_url      = "redis://${local.cache_endpoint}:${local.cache_port}"
}

# ── Shared runtime layer (VPC + NAT + ALB + prod cache + WAF) ─────────────────
# Option A: the prod VPC/NAT/ALB/WAF (and, in lean tier, a shared cache node)
# live once per env in qnsc-infra/live/runtime-prod and are consumed here via
# remote state. RDS + Fargate stay per-product below.
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/runtime-prod/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

# ── Secrets ───────────────────────────────────────────────────────────────────
module "secrets" {
  source               = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.0.0"
  prefix               = "rally/${local.env}"
  kms_key_arn          = local.kms_key_arn
  recovery_window_days = 30 # longer recovery in production

  secret_names = {
    "db-url"      = "PostgreSQL connection URL for the app"
    "jwt-private" = "EC P-256 (ES256) private key (PEM, base64-encoded)"
    "jwt-public"  = "EC P-256 (ES256) public key (PEM, base64-encoded)"
    "csrf-secret" = "CSRF token signing secret"
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

  instance_class           = local.is_ha ? "db.t4g.large" : "db.t4g.micro"
  allocated_storage_gb     = 100
  max_allocated_storage_gb = 500
  multi_az                 = local.is_ha # HA tier only — lean is single-AZ
  deletion_protection      = true
  backup_retention_days    = 30
  monitoring_interval      = local.is_ha ? 60 : 0 # Enhanced Monitoring in ha only

  tags = { Environment = local.env }
}

# ── ElastiCache Valkey ────────────────────────────────────────────────────────
# Per-product cache in the HA tier only. In lean, both products share the single
# runtime-prod cache node (key-prefixed) — see local.cache_endpoint.
module "cache" {
  count  = local.is_ha ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = local.name
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_cache_id

  mode      = "node"
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

  desired_count = local.is_ha ? 2 : 1 # ha: 2 for redundancy; lean: 1
  min_count     = local.is_ha ? 2 : 1
  max_count     = 10

  attach_alb        = true
  alb_listener_arn  = data.terraform_remote_state.runtime.outputs.https_listener_arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  alb_host_headers  = ["rally-api.qnsc.vn"] # host-based routing on the shared prod ALB
  health_check_path = "/v1/healthz"

  secret_arns = values(module.secrets.secret_arns)
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "REDIS_URL", value = local.redis_url }, # shared (lean) or per-product (ha) cache
    # Deployment mode — set per customer. 'saas' (default) = multi-tenant;
    # 'single' = one tenant, self-serve signup disabled.
    { name = "DEPLOYMENT_MODE", value = local.deployment_mode },
    { name = "SINGLE_TENANT_NAME", value = local.single_tenant_name },
    { name = "SINGLE_TENANT_SLUG", value = local.single_tenant_slug },
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

  desired_count = local.is_ha ? 2 : 1
  min_count     = local.is_ha ? 2 : 1
  max_count     = 6

  attach_alb = false

  health_check_command = "curl -f http://localhost:3001/v1/healthz || exit 1"
  container_port       = 3001

  secret_arns = values(module.secrets.secret_arns)
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_URL", value = local.redis_url },
  ]

  sqs_queue_arns     = values(module.messaging.queue_arns)
  sns_topic_arns     = values(module.messaging.topic_arns)
  log_retention_days = 90

  tags = { Environment = local.env, Service = "worker" }
}

# ── WAF: lives in runtime-prod and is associated with the shared ALB there. ──

# ── Web SPA — Cloudflare Pages (zero-egress, native SPA routing) ─────────────
# Consistent with rally develop + opshub. Cloudflare's global edge replaces the
# CloudFront PriceClass_All coverage. The custom domain (web_domain, e.g.
# "rally.qnsc.vn") is a prod product decision — the web module (Pages project +
# custom domain + DNS) is created only when cloudflare_account_id AND web_domain
# are both set, so prod applies cleanly before the public hostname is chosen.
module "web" {
  count  = var.cloudflare_account_id != "" && var.web_domain != "" ? 1 : 0
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/pages-web?ref=pages-web-v1.0.0"

  account_id  = var.cloudflare_account_id
  name        = "rally-prod-web"
  zone_id     = local.cloudflare_zone_id
  domain      = var.web_domain
  record_name = var.web_domain
  comment     = "rally-prod web SPA → Cloudflare Pages (managed by rally-infra prod)"
}
