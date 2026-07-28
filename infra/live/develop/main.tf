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
  region = "ap-southeast-1"
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

  // OFF here and in production alike — see ../prod/main.tf for the audit. Per-task
  // metrics are billed as custom CloudWatch metrics at $0.07 each and no alarm,
  // dashboard or autoscaling target in this stack reads that namespace.
  container_insights = "disabled"

  // Three dashboards are free per ACCOUNT; four environments across two products
  // means one is billable. Develop is the one to drop — its alarms still fire.
  create_dashboard = false

  // The unhealthy-target alarm treats "no registered targets" as breaching, which is
  // right for an always-on environment and wrong here: these services run on Fargate
  // SPOT, and a Spot interruption leaves zero registered targets until a replacement
  // task passes its health check. Past the 3x60s evaluation window that fires the alarm
  // — in an environment nobody is paged for. Interruptions are not hypothetical here;
  // `SpotInterruption` shows up in this service's stopped-task reasons.
  //
  // NOT justified by an off-hours cost-saver. An earlier version of this comment said
  // so, and no such scheduler exists: qnsc-ci's deploy reusable can wake a stopped RDS
  // and restore services scaled to 0, and _shared grants rds:StartDBInstance, but
  // nothing schedules any of it. If that scheduler is ever built, add it here as a
  // second reason rather than assuming it.
  monitor_target_health = false

  // Both halves of rally/develop/r2-public-* are populated, so the public-bucket
  // credential can be injected. This is a FIX, not hardening: the primary token
  // (`rally-develop-r2-app`) is scoped to `rally-develop-attachments` alone, so while
  // this was false every avatar and workspace-logo write went to the public bucket
  // with a credential that has no grant on it.
  storage_public_credentials = true

  // Step 2 of docs/runbooks/db-role-least-privilege.md: rally/develop/db-*-password
  // are populated, so the migrator can read them and the one-off cutover task can
  // set them on the roles. Inert on its own — the normal migrate entrypoint ignores
  // these, and api/worker stay on the master credential until `db_least_privilege`
  // flips in a LATER apply, after the cutover task has actually run.
  db_role_passwords_set = true

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

  // Telemetry stays DORMANT until otlp_endpoint is set: no sidecar, OTEL_ENABLED
  // false. Set the `observability-token` secret FIRST, then this.
  observability = {
    otlp_endpoint = var.otlp_endpoint
    // Full fidelity: develop volume is trivial, and validating the
    // instrumentation is the reason to enable it here at all.
    sampling_probability = 1.0
  }

  alarm_emails          = var.alarm_emails
  cloudflare_account_id = var.cloudflare_account_id
}
