terraform {
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

  ecr_base       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  ecr_api_url    = "${local.ecr_base}/rally-api:latest"
  ecr_worker_url = "${local.ecr_base}/rally-worker:latest"

  # Cloudflare IPv4 ranges — single source of truth in qnsc-infra bootstrap
  # (read via _shared remote state), so a CF range change is one edit there.
  cloudflare_ipv4 = data.terraform_remote_state.shared.outputs.cloudflare_ipv4
}

# ── Networking ────────────────────────────────────────────────────────────────
module "network" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/network?ref=network-v1.1.2"

  name   = local.name
  region = local.region
  azs    = local.azs

  vpc_cidr             = "10.20.0.0/16"
  public_subnet_cidrs  = ["10.20.0.0/24", "10.20.1.0/24", "10.20.2.0/24"]
  private_subnet_cidrs = ["10.20.10.0/24", "10.20.11.0/24", "10.20.12.0/24"]
  data_subnet_cidrs    = ["10.20.20.0/24", "10.20.21.0/24", "10.20.22.0/24"]

  multi_az_nat            = false # single NAT — saves $87/mo; outbound HA sacrificed, inbound HA (ALB) unaffected
  app_port                = 3000
  enable_flow_logs        = true
  flow_log_retention_days = 90                    # SOC 2 CC7.2 minimum
  alb_ingress_cidrs       = local.cloudflare_ipv4 # lock ALB to Cloudflare orange-cloud proxy IPs

  tags = { Environment = local.env }
}

# ── Secrets ───────────────────────────────────────────────────────────────────
module "secrets" {
  source               = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/secrets?ref=secrets-v1.0.0"
  prefix               = "rally/${local.env}"
  kms_key_arn          = local.kms_key_arn
  recovery_window_days = 30 # longer recovery in production

  secret_names = {
    "db-url"      = "PostgreSQL connection URL for the app"
    "jwt-private" = "Ed25519 private key (PEM, base64-encoded)"
    "jwt-public"  = "Ed25519 public key (PEM, base64-encoded)"
    "csrf-secret" = "CSRF token signing secret"
    "redis-url"   = "Redis/Valkey connection URL"
  }

  tags = { Environment = local.env }
}

# ── RDS PostgreSQL 17 (Multi-AZ) ─────────────────────────────────────────────
module "rds" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/rds?ref=rds-v1.1.0"

  identifier        = local.name
  subnet_ids        = module.network.data_subnet_ids
  security_group_id = module.network.sg_rds_id
  kms_key_arn       = local.kms_key_arn

  instance_class           = "db.t4g.large"
  allocated_storage_gb     = 100
  max_allocated_storage_gb = 500
  multi_az                 = true # HA in production
  deletion_protection      = true
  backup_retention_days    = 30

  tags = { Environment = local.env }
}

# ── ElastiCache Valkey ────────────────────────────────────────────────────────
module "cache" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = local.name
  subnet_ids        = module.network.data_subnet_ids
  security_group_id = module.network.sg_cache_id

  max_data_storage_gb     = 10
  max_ecpu_per_second     = 10000
  snapshot_retention_days = 7

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

# ── ALB ───────────────────────────────────────────────────────────────────────
module "alb_logs" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/alb-logs?ref=alb-logs-v1.0.0"

  bucket_name = "${local.name}-alb-logs"
  tags        = { Environment = local.env }
}

# ── ALB (shared module: LB + HTTPS/HTTP listener pair) ───────────────────────
# Prod: deletion protection on + access logs to the alb_logs bucket. The API
# attaches to the HTTPS listener directly (see module.api below), so no
# separate /v1/* HTTP-forward rule (that's a develop-only CloudFront quirk).
module "alb" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/alb?ref=alb-v1.0.0"

  name               = local.name
  security_group_ids = [module.network.sg_alb_id]
  subnet_ids         = module.network.public_subnet_ids
  certificate_arn    = var.acm_cert_arn

  enable_deletion_protection = true
  access_logs_bucket         = module.alb_logs.bucket_id

  tags = { Environment = local.env }
}

# ── ECS Cluster ───────────────────────────────────────────────────────────────
module "ecs_cluster" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-cluster?ref=ecs-cluster-v1.0.0"
  name   = local.name
  tags   = { Environment = local.env }
}

# ── ECS Service — API ─────────────────────────────────────────────────────────
module "api" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.1.0"

  service_name = "api"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_api_url

  cpu    = 1024
  memory = 2048

  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.sg_app_id

  desired_count = 2 # at least 2 for HA
  min_count     = 2
  max_count     = 10

  attach_alb        = true
  alb_listener_arn  = module.alb.https_listener_arn
  alb_priority      = 100
  alb_path_patterns = ["/*"]
  health_check_path = "/v1/healthz"

  secret_arns = values(module.secrets.secret_arns)
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "REDIS_URL", secret_arn = module.secrets.secret_arns["redis-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
    { name = "CSRF_SECRET", secret_arn = module.secrets.secret_arns["csrf-secret"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecs-service?ref=ecs-service-v1.1.0"

  service_name = "worker"
  cluster_name = module.ecs_cluster.cluster_name
  cluster_arn  = module.ecs_cluster.cluster_arn
  region       = local.region
  image_uri    = local.ecr_worker_url

  cpu    = 512
  memory = 1024

  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.sg_app_id

  desired_count = 2
  min_count     = 2
  max_count     = 6

  attach_alb = false

  health_check_command = "curl -f http://localhost:3001/v1/healthz || exit 1"
  container_port       = 3001

  secret_arns = values(module.secrets.secret_arns)
  secrets = [
    { name = "DATABASE_URL", secret_arn = module.secrets.secret_arns["db-url"] },
    { name = "REDIS_URL", secret_arn = module.secrets.secret_arns["redis-url"] },
    { name = "JWT_PRIVATE_KEY", secret_arn = module.secrets.secret_arns["jwt-private"] },
    { name = "JWT_PUBLIC_KEY", secret_arn = module.secrets.secret_arns["jwt-public"] },
  ]

  environment_vars = [
    { name = "NODE_ENV", value = "production" },
  ]

  sqs_queue_arns     = values(module.messaging.queue_arns)
  sns_topic_arns     = values(module.messaging.topic_arns)
  log_retention_days = 90

  tags = { Environment = local.env, Service = "worker" }
}

# ── WAF ───────────────────────────────────────────────────────────────────────
module "waf" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/waf?ref=waf-v1.0.1"

  name                = local.name
  alb_arn             = module.alb.arn
  rate_limit_per_5min = 3000

  tags = { Environment = local.env }
}

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
