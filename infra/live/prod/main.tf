// rally · production
//
// Structurally identical to ../develop by construction: the entire stack lives in
// ../../modules/stack and only the values below differ. Production takes the
// DEDICATED, durable settings — on-demand Fargate, RDS with deletion protection and
// 30-day backups, 90-day retention, a pinned image tag — while develop takes the
// shared, cheap ones.
//
// RDS is deliberately PRE-LAUNCH sized right now (single-AZ, t4g.micro, Enhanced
// Monitoring off). See the go-live checklist above the `rds` block: those settings flip
// back to the Multi-AZ posture before the first real user, not after.
//
// Security posture is NOT a per-environment value: the cache module always
// enables KMS at rest and TLS in transit, so develop cannot be the weaker one.
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
  region = "ap-southeast-1"
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

  // OFF, including in production. Audited every consumer: all 7 alarms and all 6
  // dashboard widgets read AWS/ECS, AWS/ApplicationELB and AWS/RDS — native namespaces
  // that are free and published whether Container Insights is on or off. Nothing reads
  // the ECS/ContainerInsights namespace at all, so "enabled" was billing custom metrics
  // no alarm, no autoscaling target and no dashboard panel queries. Application metrics
  // go to the OTLP backend, not CloudWatch, so they are unaffected too.
  //
  // Turn it to "enhanced" temporarily when you need per-task or per-container drilldown
  // during an incident, then turn it back. For right-sizing, AWS/ECS CPUUtilization as a
  // percentage of a known task size is the same arithmetic.
  container_insights = "disabled"

  // Kept here and dropped in develop. This is the one someone opens during an
  // incident, and it is inside the 3-per-account free tier.
  create_dashboard = true

  // Zero running tasks is never normal here, so "no registered targets" breaching is
  // exactly the signal wanted — this is the only alarm that catches an outage which
  // produces no load to make CPU, latency or 5xx move.
  monitor_target_health = true

  // Both halves of rally/production/r2-public-* are populated, so the public-bucket
  // credential can be injected. Same fix as develop: `rally-production-r2-app` is scoped
  // to `rally-prod-attachments` alone, so public-asset writes had no grant. Production
  // has had no users, so nothing has hit it yet — this lands before it can.
  storage_public_credentials = true

  // Step 2 of docs/runbooks/db-role-least-privilege.md, same as develop and equally
  // inert: the migrator can read the role passwords so the one-off cutover task can
  // set them. `db_least_privilege` stays false here until develop has run a full
  // deploy cycle on the restricted roles — the runbook's develop-first rule.
  db_role_passwords_set = true

  // PRE-LAUNCH sizing. Multi-AZ t4g.small with Enhanced Monitoring is the right
  // production posture and it is what this becomes at go-live — but it costs about
  // $101/mo, and every dollar of it currently buys durability for a database with no
  // users. Multi-AZ doubles the instance rate AND bills the mirrored volume, so 100 GB
  // allocated meant paying for 200 GB nothing had written to.
  //
  // GO-LIVE CHECKLIST — flip all four together, before the first real user:
  //     instance_class      = "db.t4g.small"  # 2 GB rather than 1 GB
  //     multi_az            = true            # AZ failure becomes a failover,
  //                                           # not an outage plus restore
  //     monitoring_interval = 60              # per-process and per-device visibility
  //                                           # CloudWatch metrics alone do not give
  //     allocated_storage_gb: raise on evidence, never speculatively (see below)
  //
  // Reverting Multi-AZ does NOT break the deploy pipeline: the `ensure_rds` step in
  // qnsc-ci's backend-deploy reusable checks status and starts a stopped instance
  // regardless of AZ topology, so it is a no-op on an always-available database.
  //
  // 30 GB, not 100: `max_allocated_storage_gb` below already autoscales, and RDS gp3
  // gives the same 3,000 baseline IOPS and 125 MiB/s at every size under 400 GB, so
  // over-allocating buys nothing. Treat any increase as PERMANENT — RDS refuses to
  // shrink a volume and a snapshot restore cannot land smaller, so coming back down
  // needs the instance replaced (docs/runbooks/rds-storage-shrink.md).
  rds = {
    instance_class           = "db.t4g.micro"
    allocated_storage_gb     = 30
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

  // Telemetry stays DORMANT until otlp_endpoint is set: no sidecar, OTEL_ENABLED
  // false. Set the `observability-token` secret FIRST, then this.
  observability = {
    otlp_endpoint = var.otlp_endpoint
    // Cost control. Note this drops most ERROR traces too — keeping every
    // error needs tail sampling, which needs a gateway, not a sidecar.
    sampling_probability = 0.1
  }

  alarm_emails          = var.alarm_emails
  cloudflare_account_id = var.cloudflare_account_id
}
