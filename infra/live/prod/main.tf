// rally · production
//
// Structurally identical to ../develop by construction: the entire stack lives in
// ../../modules/stack and only the values below differ. Production takes the
// DEDICATED, durable settings — on-demand Fargate, larger RDS with deletion
// protection and 30-day backups, 90-day retention, a pinned image tag — while
// develop takes the shared, cheap ones.
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

provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

locals {
  name   = "rally-prod"
  region = "ap-southeast-1"
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Dedicated per-product node from the shared module: KMS at rest and TLS in transit,
// hence `rediss://`. Declared here rather than in the stack module only until develop
// adopts the same module — see ../develop/main.tf for why that migration is separate.
module "cache" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/cache?ref=cache-v1.0.0"

  name              = "${local.name}-cache"
  subnet_ids        = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  security_group_id = data.terraform_remote_state.runtime.outputs.sg_cache_id
  kms_key_arn       = data.terraform_remote_state.shared.outputs.kms_key_arn

  mode      = "node" # single cache.t4g.micro (~$12/mo) — serverless floors at ~$90
  node_type = "cache.t4g.micro"

  tags = { Environment = "production" }
}

data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/runtime-prod/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

// The cache module needs the KMS key, which the product's _shared stack owns.
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "rally/shared/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

// ── The stack ─────────────────────────────────────────────────────────────────
module "stack" {
  source = "../../modules/stack"

  product = "rally"
  env     = "production"
  // Resources are named `rally-prod`, not `rally-production`: renaming them would
  // force replacement of the cluster, the RDS instance and every log group.
  env_slug = "prod"
  region   = local.region

  app_domain = "rally.qnsc.vn"
  api_domain = "rally-api.qnsc.vn"
  web_record = "rally"
  api_record = "rally-api"

  shared_state_key  = "rally/shared/terraform.tfstate"
  runtime_state_key = "platform/runtime-prod/terraform.tfstate"
  storage_state_key = "platform/storage-prod/terraform.tfstate"

  // Production runs the tag the release built, never a floating `latest`.
  image_tag = var.image_tag
  redis_url = "rediss://${module.cache.endpoint}:${module.cache.port}"

  // Never seed demo data into production.
  seed_on_deploy        = false
  platform_admin_emails = var.platform_admin_emails

  entra_tenant_id = var.entra_tenant_id
  entra_client_id = var.entra_client_id
  github_app_id   = var.github_app_id

  // 90 days is the SOC 2 minimum; the recovery window keeps a mistaken destroy
  // recoverable.
  log_retention_days           = 90
  secrets_recovery_window_days = 30
  dlq_max_receive_count        = 3 # move to the DLQ sooner in production

  rds = {
    instance_class           = "db.t4g.micro"
    allocated_storage_gb     = 100
    max_allocated_storage_gb = 500
    multi_az                 = false
    deletion_protection      = true
    backup_retention_days    = 30
    monitoring_interval      = 0
  }

  // On-demand, not Spot: an interruption here is user-visible. Tighter autoscale
  // targets and more headroom than develop.
  api = {
    cpu               = 1024
    memory            = 2048
    max_count         = 10
    use_spot          = false
    cpu_target_pct    = 60
    memory_target_pct = 70
  }

  worker = {
    cpu       = 512
    memory    = 1024
    max_count = 6
    use_spot  = false
  }

  alarm_emails          = var.alarm_emails
  cloudflare_account_id = var.cloudflare_account_id
}
