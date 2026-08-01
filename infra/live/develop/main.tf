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

  // ── Secret bundling · COMPLETE ──────────────────────────────────────────────
  // Every app secret lives in ONE container, rally/develop/app, read per key by ECS via
  // the `<arn>:<key>::` form of valueFrom. Secrets Manager bills per SECRET regardless of
  // size, so this is 12 containers' worth of material for one container's fee.
  //
  // `secrets_create_standalone` is now unset (defaults to !use_bundle = false), which
  // DESTROYS the 12 standalone secrets and is what realises the saving. Safe to do here
  // only because all three consumers were proven against the bundle first — api, worker
  // and migrator each rolled onto it via the normal deploy pipeline (#313) and reached
  // steady state, with /v1/readyz reporting postgres and valkey up.
  //
  // NO LONGER A ONE-LINE ROLLBACK. recovery_window_days = 0 in this environment, so the
  // standalone secrets are gone for good once this applies. Reverting means recreating
  // them AND re-pasting all 12 values by hand. The bundle itself is the backup — do not
  // delete it casually.
  //
  // Repeating this in production: populate and verify the bundle key-by-key BEFORE
  // setting use_bundle. The qnsc-ci deploy preflight proves the container is non-empty,
  // not that every key is present, so a bundle missing one key passes CI and fails at
  // task boot. Full sequence and the verify script:
  // docs/runbooks/secrets-bundle-migration.md.
  secrets_bundle_name = "app"
  secrets_use_bundle  = true

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
  // ALSO justified by the idle schedule now, which is a REVERSAL of what this comment
  // used to say. It claimed no off-hours scheduler existed. One does: `idle_schedule`
  // below creates three EventBridge schedules (rds-stop, api-scale-down,
  // worker-scale-down) that take this environment to zero tasks nightly, verified
  // firing in CloudTrail. Zero tasks means zero registered targets, which this alarm
  // treats as breaching — so leaving it on would page nobody-in-particular every night
  // by design.
  //
  // The Spot reason above still stands independently, and is the reason this was
  // originally false.
  monitor_target_health = false

  // Nightly, not weekly like production. Develop wakes on every merge to main, so a
  // weekly stop would leave it running most of the week; 21:00 local puts it down after
  // the working day and the next deploy brings it back.
  //
  // There is no matching START schedule on purpose. The deploy pipeline is the wake
  // signal, so develop is up exactly on the days it is being changed. Adding a morning
  // start would pay for the days nobody touches it — which is most of them.
  //
  // TWO PASSES, 21:00 AND 03:00 — because ONE was not holding. Measured 2026-08-02:
  // develop's RDS published CPU datapoints for every hour of every night across seven
  // days, i.e. it was never actually down. CloudTrail shows why:
  //
  //   21:00:36  StopDBInstance   (this schedule — fires correctly, every night)
  //   21:33:07  StartDBInstance  (GitHubActions — `ensure_rds` in the deploy reusable)
  //
  // A deploy landing after 21:00 wakes RDS and scales the services back up, and nothing
  // stopped them again until 21:00 the FOLLOWING day. 6 of 40 sampled deploys ran at
  // 21:00-02:00 local, so develop was billing ~24h/day for maybe 10h of use. This is a
  // control-loop problem, not a sizing one: a once-daily stop cannot hold against a wake
  // signal that fires at any hour.
  //
  // 03:00 is chosen to sit after the late-evening deploy window and before the working
  // day. A deploy at 02:00 still gets its environment; one at 22:00 no longer leaves it
  // running all night. If deploys routinely land between 03:00 and 09:00, add a third
  // pass rather than moving this one.
  idle_schedule = "cron(0 21,3 * * ? *)"

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

  // Step 3, the last one: api and worker stop connecting as the RDS master.
  //
  // The cutover task ran here on 2026-07-29 (task
  // 17d5bd4504bd43959c7dc531cbd36c95, exit 0) and verified BOTH roles against this
  // database: LOGIN works, none of rolsuper/rolbypassrls/rolcreatedb/rolcreaterole/
  // rolreplication is set, and CREATE TABLE as the role is denied.
  //
  // Enabling this the first time (#246) broke every file write, and the fix is a
  // migration rather than this flag. Moving off master also moves the app off being
  // the table OWNER, and Postgres exempts only the owner from row-level security, so
  // two leftover `tenant_isolation` policies on storage.files and
  // work.work_item_attachments executed for the first time. They require
  // `app.workspace_id`, which nothing sets, so they denied every insert. Migration
  // 0070 drops them, completing the teardown migration 0025 began — Rally is
  // single-tenant and DB-level isolation is an explicit non-goal, so those two
  // policies (2 of 41 workspace-scoped tables) were never a boundary.
  //
  // The MIGRATOR keeps the master credential — it needs DDL. Narrowing it means
  // transferring schema ownership, which is step 4 and deliberately separate.
  //
  // Rollback is this line and a rolling restart: the master credential is untouched
  // and the app holds no state tied to the role it connected as.
  db_least_privilege = true

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
  // ── IDLE BY DEFAULT, WOKEN BY DEPLOYS ───────────────────────────────────────
  // `min_count = 0` on both services. Develop is exercised by CI deploys and the odd
  // manual check, not by users — its ALB sees a handful of requests a day — so paying
  // for two tasks around the clock buys nothing.
  //
  // Waking needs no new machinery and no schedule: qnsc-ci's deploy reusable already
  // restores services scaled to 0 and calls `ensure_rds` to start a stopped instance,
  // and `_shared` already grants the develop deploy role `rds:StartDBInstance`. Every
  // merge to main therefore brings develop up on its own. `idle_schedule` below
  // puts it back down nightly.
  //
  // AUTOSCALING IS OFF HERE, and that is the load-bearing part.
  //
  // Deploys and `idle_schedule` between them own the desired count, so the floor has to
  // be 0 — with a floor of 1 Application Auto Scaling restores the service within minutes
  // and the 21:00 scale-to-zero undoes itself.
  //
  // But a scalable target with a floor of 0 cannot act at all, in either direction. Target
  // tracking scales proportionally, so from one task at ~1% CPU it computes
  // ceil(1 x 1/65) = 1 and never reaches zero; and once the schedule has taken the service
  // to zero there is no CPU or memory metric left for it to scale out from. Measured here,
  // not assumed: develop ran for hours at 0.07-1.0% average CPU against a floor of 0, and
  // Application Auto Scaling logged ZERO scaling activities across its six-week retention.
  //
  // So autoscaling was never fighting the schedule — it was inert, while billing four
  // CloudWatch alarms per service. `enable_autoscaling = false` says that out loud and
  // leaves exactly one writer: `desired_count` is under `ignore_changes` in the
  // ecs-service module, the deploy sets it to 1, the nightly schedule sets it to 0.
  //
  // Losing it costs develop nothing regardless: no users to absorb a spike for, and
  // `max_count` was never approached. Production restores it at go-live along with a floor
  // of 1 — see ../prod/main.tf, and the validation that ties those two together.
  //
  // NOT done with scheduled autoscaling ACTIONS, which is the other obvious shape:
  // `aws_appautoscaling_target` has no `ignore_changes` on min/max, so a scheduled
  // action mutating them would drift, and any infra-apply running at night would
  // silently wake develop. Same silent-reset shape as the `task_definition` and
  // `desired_count` cases documented in CLAUDE.md.
  //
  // `min_count`/`max_count` stay set: they no longer drive scaling, but `max_count`
  // sizes the DB connection pool and `min_count = 0` on both services is what marks
  // this environment idle (suppressing the load alarms) and what the cacheless-tasks
  // check reads.
  api = {
    cpu                = 512
    memory             = 1024
    max_count          = 3
    min_count          = 0
    enable_autoscaling = false
    use_spot           = true
  }

  // Idled with the api — see the note above.
  worker = {
    cpu                = 256
    memory             = 512
    max_count          = 2
    min_count          = 0
    enable_autoscaling = false
    use_spot           = true
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
