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

// Route 53 publishes health-check metrics ONLY to us-east-1, so the ingress alarm in
// module.stack has to be created there. Everything else stays in ap-southeast-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "rally"
      Environment = "production"
      ManagedBy   = "opentofu"
    }
  }
}

locals {
  region = "ap-southeast-1"
}

// ── The stack ─────────────────────────────────────────────────────────────────
module "stack" {
  source = "../../modules/stack"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

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

  // ── Secret bundling · COMPLETE ──────────────────────────────────────────────
  // Every app secret lives in ONE container, rally/production/app, read per key by ECS
  // via the `<arn>:<key>::` form of valueFrom. Secrets Manager bills per SECRET
  // regardless of size, so this is 12 containers' worth of material for one fee.
  //
  // Develop completed the same migration on 2026-08-01 (#313, #314); the sequence and
  // the populate/verify script are in docs/runbooks/secrets-bundle-migration.md.
  //
  // HOW THIS WAS VERIFIED WITHOUT A RUNNING TASK. Production is idle pre-launch
  // (min_count = 0 on both services, RDS stopped, no cache node), so unlike develop
  // nothing boots to prove the cutover. Two checks stood in for that, and both must be
  // repeated if this is ever redone:
  //   1. sha256 per key, bundle vs standalone — all 12 identical (bundle-secrets.sh
  //      --verify).
  //   2. every `<arn>:<key>::` reference in the api, worker AND migrator task
  //      definitions resolved against the bundle exactly as ECS does, confirming the key
  //      is present and non-empty.
  //
  // The migrator is the one to watch. It is NOT covered by a -target on module.api or
  // module.worker, and it was still pointing at the standalone secrets after those two
  // had been cut over — a step-4 destroy at that moment would have deleted secrets it
  // still referenced. Plan the WHOLE stack, not a subset, before dropping standalone.
  //
  // RECOVERABLE FOR 30 DAYS, unlike develop: recovery_window_days = 30 above, so the
  // destroyed containers are scheduled rather than gone. Restore with
  // `aws secretsmanager restore-secret --secret-id rally/production/<name>` inside that
  // window; after it, they must be recreated and re-pasted by hand.
  //
  // AT GO-LIVE, treat any boot failure mentioning secrets as this change first. Rollback
  // is `secrets_use_bundle = false`, `secrets_create_standalone = true`, apply, redeploy.
  secrets_bundle_name = "app"
  secrets_use_bundle  = true

  // ── Ingress via Cloudflare Tunnel, not the shared ALB ───────────────────────
  // cloudflared runs as a sidecar in the api task and dials OUT to Cloudflare, so
  // production needs no ALB listener rule, no target group and no public IPv4. Every
  // request already arrived through Cloudflare — the SPA proxies /v1/* to API_ORIGIN
  // and the ALB security group admitted only Cloudflare edge ranges — so the load
  // balancer was a second TLS termination inside an already-proxied path.
  //
  // Setting this also sets `attach_alb = false`: a tunnel-served task must not
  // simultaneously be an ALB target.
  //
  // MONITORING MOVED, it did not disappear. `monitor_target_health` cannot exist
  // without a target group, so the Route 53 health check created by this module
  // (aws_route53_health_check.api_ingress) is what catches an outage producing no
  // load. It probes rally-api.qnsc.vn/v1/healthz from outside AWS, so it exercises the
  // whole user path rather than any one component's opinion of itself.
  //
  // THAT CHECK IS CURRENTLY OFF — see `monitor_ingress` below. Production therefore has
  // NO ingress alarm at all today, which is correct while it serves nothing and wrong
  // the moment it does.
  //
  // ROLLBACK is not instant: set tunnel_enabled = false, apply, redeploy. That
  // recreates the ALB attachment, but the runtime layer's ALB must exist first
  // (enable_alb there) and it comes back with a NEW DNS name.
  tunnel_enabled = true
  tunnel_id      = "27d68d57-6acf-4516-98e1-dab55ea0512e" // rally-production

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

  // OFF while production is IDLE (see the idle posture on api/worker below). This alarm
  // treats missing data as breaching, because a target group with no registered targets
  // publishes nothing at all and that is normally the outage worth paging on — which is
  // exactly why it cannot stay on while zero tasks is the intended state. Leaving it
  // enabled during the idle turned the deliberate shutdown into a page.
  //
  // TURN THIS BACK ON at go-live, in the same change that restores min_count. It is the
  // only alarm that catches an outage producing no load to move CPU, latency or 5xx.
  monitor_target_health = false

  // OFF for the same reason, and it is the TUNNELLED half of the pair above. The Route 53
  // health check probes rally-api.qnsc.vn from outside AWS; production runs zero tasks, so
  // it reported DOWN continuously from creation — $2.70/mo ($0.75 base + $2.00 options) to
  // be paged every minute about the state this environment is deliberately in. An alarm
  // that is always red is worse than no alarm: it is the one signal that replaces every
  // ALB target-group alarm, and a reader who has learned to ignore it will ignore the
  // real outage too.
  //
  // TURN THIS BACK ON at go-live, in the same change as monitor_target_health and
  // min_count. While tunnel_enabled = true this is production's ONLY ingress alarm —
  // ECS reports a task RUNNING whether or not cloudflared holds edge connections, so
  // without it an ingress outage is visible only when a user reports it.
  monitor_ingress = false

  // Weekly re-stop, because AWS force-starts a stopped instance after 7 days. Sunday
  // 01:00 local sits well inside that window, so the instance is never up for more than
  // a few hours of a week it is not being used.
  //
  // REMOVE THIS AT GO-LIVE, in the same change that restores min_count and
  // monitor_target_health. A schedule that stops production every Sunday is precisely
  // the kind of leftover that becomes an outage nobody can explain.
  // No cache node while idled. ElastiCache has no stopped state — only delete — so the
  // node is the one part of an idled environment that keeps billing (~$10/mo).
  //
  // Safe ONLY because both service floors are 0 above, and the `check` block in the
  // stack module enforces that pairing: a task that cannot reach its cache does not
  // fail, it falls back to localhost and runs with the token denylist and rate limiter
  // failed open. So "no cache" and "no tasks" have to move together, and Terraform now
  // refuses any plan where they do not.
  //
  // RE-ENABLE AT GO-LIVE in the same change that restores the floors. Recreating the
  // node takes ~10 minutes and issues a NEW endpoint, which is fine here only because
  // production has no sessions to lose. Mind the id-namespace collision documented in
  // CLAUDE.md if the replacement reuses this name while the old one is still deleting.
  cache = {
    enabled = false
  }

  idle_schedule = "cron(0 1 ? * SUN *)"

  // Both halves of rally/production/r2-public-* are populated, so the public-bucket
  // credential can be injected. Same fix as develop: `rally-production-r2-app` is scoped
  // to `rally-prod-attachments` alone, so public-asset writes had no grant. Production
  // has had no users, so nothing has hit it yet — this lands before it can.
  storage_public_credentials = true

  // Step 2 of docs/runbooks/db-role-least-privilege.md, same as develop and equally
  // inert: the migrator can read the role passwords so the one-off cutover task can
  // set them.
  db_role_passwords_set = true

  // Step 3, the last one: api and worker stop connecting as the RDS master.
  //
  // Until this, every production connection was `app_admin`, which OWNS every table —
  // so an ordinary HTTP request carried the right to DROP the schema it was reading.
  //
  // The develop-first rule this file used to cite has been satisfied, and it earned its
  // keep: enabling it in develop first is what exposed two `tenant_isolation` RLS
  // policies that denied every file write once the app stopped being the table owner.
  // Had both environments flipped together that would have been a production outage.
  // Migration 0070 dropped those policies, `test/e2e/file-storage-flow.e2e.spec.ts`
  // now fails if RLS ever returns, and this database reports zero RLS-enabled tables.
  //
  // The cutover task ran here on 2026-07-29 (task
  // 747f5e5183c046d6afb399b3810f007e on rally-prod-migrator:15, exit 0). Verified
  // independently afterwards against this database: rally_app and rally_worker both
  // have rolcanlogin=true with rolsuper/rolbypassrls/rolcreatedb/rolcreaterole all
  // false, and a real connection as rally_app succeeded.
  //
  // The MIGRATOR keeps the master credential — it needs DDL. Narrowing it means
  // transferring schema ownership, which is step 4 and deliberately separate.
  //
  // Rollback is this line and a rolling restart: the master credential is untouched
  // and the app holds no state tied to the role it connected as.
  db_least_privilege = true

  // PRE-LAUNCH sizing. Every dollar here currently buys durability for a database with
  // no users, so the instance is stopped and single-AZ until launch.
  //
  // GO-LIVE CHECKLIST — flip these together, before the first real user:
  //     instance_class      = "db.t4g.small"  # 2 GB rather than 1 GB
  //     monitoring_interval = 60              # per-process and per-device visibility
  //                                           # CloudWatch metrics alone do not give
  //     allocated_storage_gb: raise on evidence, never speculatively (see below)
  //
  // MULTI-AZ IS DELIBERATELY NOT ON THAT LIST — decided 2026-08-02, and it is the one
  // item here that trades availability for cost rather than deferring spend.
  //
  // What it costs: $52.32/mo ($48.18 doubled instance rate + $4.14 mirrored volume at
  // 30 GB), a third of the entire go-live delta and more than every other candidate
  // combined. See docs/go-live-cost-delta.md.
  //
  // What single-AZ means when an AZ fails, stated plainly so nobody rediscovers it
  // during an incident:
  //   - Multi-AZ: AWS fails over to the standby, typically 60-120s, no data loss.
  //   - Single-AZ: the database is DOWN until AWS restores the AZ, or until someone
  //     restores from a snapshot into another AZ. Restore is a manual, multi-hour
  //     operation, and it loses everything written since the last backup — up to 24h
  //     with the current daily automated snapshot, though PITR narrows that to ~5min
  //     within the 30-day backup_retention_days window below.
  //
  // So the exposure is an outage of hours, not a permanent data loss, provided the
  // 30-day retention stays. Do not lower backup_retention_days while single-AZ: PITR is
  // what keeps this a recoverable outage rather than a real loss event.
  //
  // REVISIT WHEN: the product carries paying users, an availability commitment (SLA,
  // contract, SOC 2 CC7.x continuity), or a workload where hours of downtime costs more
  // than $52/mo. Turning it on later is a single flag plus an apply — RDS converts a
  // single-AZ instance to Multi-AZ in place, with a brief failover, no data migration
  // and no endpoint change. Nothing about this decision is one-way.
  //
  // Multi-AZ does NOT affect the deploy pipeline either way: the `ensure_rds` step in
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
  // ── IDLE UNTIL GO-LIVE ──────────────────────────────────────────────────────
  // `min_count = 0` on both services, so production runs no tasks. Production has
  // never served a user — the ALB logged 4, 1, 0, 1 requests on four consecutive days,
  // and the only non-zero days since are SCM webhooks and synthetic probes — while
  // costing ~$52/mo in on-demand Fargate alone, a third of the account.
  //
  // The floor is what makes it hold. `desired_count` is under `ignore_changes`, so
  // scaling to zero by hand is expected and non-drifting, but Application Auto Scaling
  // restores the service to `min_count` within minutes, so a scale-to-zero against a
  // floor of 1 silently undoes itself.
  //
  // AUTOSCALING IS THEREFORE OFF TOO, not just floored at zero — because with a floor of
  // 0 the scalable target cannot do anything. Target tracking scales proportionally, so it
  // never computes zero from a running task, and a service at zero tasks publishes no CPU
  // or memory metric for it to scale out from. Measured on this account: production sat at
  // 0/0 tasks for days with a registered target, and develop ran at 0.07-1.0% average CPU
  // against a floor of 0 — Application Auto Scaling logged ZERO scaling activities for
  // either, across its full six-week retention.
  //
  // So this is not a bug being fixed; it is a config that claimed to scale and could not.
  // Removing it drops four CloudWatch alarms per service (16 across both environments,
  // ~$1.60/mo) and stops the plan describing capacity behaviour that does not exist.
  //
  // TO RESTORE AT GO-LIVE: set both min_count back to 1, set both enable_autoscaling back
  // to true, set monitor_target_health back to true above, and deploy. A `validation` block
  // on the stack module's `api` and `worker` variables enforces that min_count/
  // enable_autoscaling pairing, because the combination it forbids — autoscaling on with a
  // floor of 0 — is a LIVE environment that cannot self-heal: nothing publishes a metric at
  // zero tasks, so whatever scaled it down is permanent. The deploy
  // pipeline sets desired_count, and qnsc-ci's `ensure_rds` starts the stopped instance,
  // so no manual step is needed beyond this file. Nothing else about the environment
  // changed — same task definitions, same secrets, same database, same cache.
  //
  // RDS run-state is not a Terraform concept, so the instance is stopped out of band —
  // but AWS FORCE-STARTS a stopped instance after 7 days, so `idle_schedule` below
  // re-stops it weekly. Without that the saving silently evaporates.
  api = {
    cpu       = 1024
    memory    = 2048
    max_count = 10
    min_count = 0
    // Restore to true at go-live together with min_count — see the note above.
    enable_autoscaling = false
    use_spot           = false
    // Inert while enable_autoscaling is false, kept because go-live wants these targets
    // and not the module defaults (65/75). Tighter than develop: production absorbs a
    // spike by adding tasks earlier.
    cpu_target_pct    = 60
    memory_target_pct = 70
  }

  // Idled with the api — see the note above.
  //
  // SPOT, unlike the api. The worker is a relay: AbstractOutboxRelay claims rows with
  // FOR UPDATE SKIP LOCKED, retries with exponential backoff, and every write is an
  // idempotent upsert — so a task disappearing mid-batch loses no work, it just leaves
  // the rows claimed-then-released for the next tick. Spot's two-minute interruption
  // notice is longer than a 5-second relay cycle needs.
  //
  // That is not true of the api, which is why it stays on-demand: an interruption there
  // is a request nobody retries and an SSE stream that drops. Interruptions are real, not
  // hypothetical — `SpotInterruption` already appears in develop's stopped-task reasons.
  //
  // Saves ~$15.60/mo at this sizing once production runs continuously ($22.49 on-demand
  // versus $6.90 on Spot).
  worker = {
    cpu                = 512
    memory             = 1024
    max_count          = 6
    min_count          = 0
    enable_autoscaling = false
    use_spot           = true
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
