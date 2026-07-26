// rally · develop
//
// This file is deliberately thin. The entire stack lives in ../../modules/stack, so
// develop and production cannot drift structurally — only the values below differ.
// Develop leans on SHARED, cheap infrastructure (Fargate Spot, small RDS, short
// retention); production takes the dedicated, durable settings. Adding a resource
// means editing the module once, not both environments.
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

// Reads CLOUDFLARE_API_TOKEN (or TF_VAR_cloudflare_api_token). DNS/Pages resources
// are skipped when the zone is unset, so the stack applies before Cloudflare exists.
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

locals {
  name   = "rally-develop"
  region = "ap-southeast-1"
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Still declared here rather than in the module: production uses the shared `cache`
// module (KMS at rest, TLS in transit, `rediss://`) while this inline node has
// neither. Unifying them REPLACES this node and changes the connection scheme, which
// logs every develop user out — BFF sessions live only in the cache. That is a
// deliberate follow-up change, not something to bury inside a structural refactor.
resource "aws_elasticache_subnet_group" "cache" {
  name       = "${local.name}-cache"
  subnet_ids = data.terraform_remote_state.runtime.outputs.data_subnet_ids
  tags       = { Environment = "develop" }
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
  tags               = { Environment = "develop" }
}

// The cache lives outside the ECS tasks so it survives task replacement — the fix
// for "every dev deploy logs users out", since BFF sessions are stored only here.
data "terraform_remote_state" "runtime" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/runtime-dev/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

// ── The stack ─────────────────────────────────────────────────────────────────
module "stack" {
  source = "../../modules/stack"

  product  = "rally"
  env      = "develop"
  env_slug = "develop"
  region   = local.region

  app_domain = "rally-dev.qnsc.vn"
  api_domain = "rally-api-dev.qnsc.vn"
  web_record = "rally-dev"
  api_record = "rally-api-dev"

  shared_state_key  = "rally/shared/terraform.tfstate"
  runtime_state_key = "platform/runtime-dev/terraform.tfstate"
  storage_state_key = "platform/storage-dev/terraform.tfstate"

  // Develop tracks the newest image; production pins a release tag.
  image_tag = "latest"
  redis_url = "redis://${aws_elasticache_cluster.cache.cache_nodes[0].address}:6379"

  // Develop seeds demo data after migrating; production must never.
  seed_on_deploy        = true
  platform_admin_emails = var.platform_admin_emails

  entra_tenant_id = var.entra_tenant_id
  entra_client_id = var.entra_client_id
  github_app_id   = var.github_app_id

  // Cost-leaning: short retention, immediate secret deletion so a
  // destroy+redeploy cycle does not trip "secret scheduled for deletion".
  log_retention_days           = 7
  secrets_recovery_window_days = 0

  rds = {
    instance_class           = "db.t4g.micro"
    allocated_storage_gb     = 20
    max_allocated_storage_gb = 100
    multi_az                 = false
    deletion_protection      = false # easy teardown in develop
    backup_retention_days    = 3
    monitoring_interval      = 0 # Enhanced Monitoring off — saves CloudWatch cost
  }

  // Fargate Spot: ~70% cheaper, and an interruption in develop is harmless.
  api = {
    cpu       = 512
    memory    = 1024
    max_count = 3
    use_spot  = true
  }

  worker = {
    cpu       = 256
    memory    = 512
    max_count = 2
    use_spot  = true
  }

  alarm_emails          = var.alarm_emails
  cloudflare_account_id = var.cloudflare_account_id
}
