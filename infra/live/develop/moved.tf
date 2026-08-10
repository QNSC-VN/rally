// Relocation map for the stack extraction.
//
// Every address below moved from the root of this stack into `module.stack`. Without
// these blocks Terraform reads the change as "destroy 30-odd resources, create 30-odd
// identical ones" — including the RDS instance and the ECS cluster. With them it
// simply relabels state, which is why the plan for this refactor reads
// `0 to add, 0 to change, 0 to destroy`.
//
// Safe to delete once both environments have applied.

moved {
  from = module.secrets
  to   = module.stack.module.secrets
}

moved {
  from = module.rds
  to   = module.stack.module.rds
}

moved {
  from = module.ecs_cluster
  to   = module.stack.module.ecs_cluster
}

moved {
  from = module.api
  to   = module.stack.module.api
}

moved {
  from = module.worker
  to   = module.stack.module.worker
}

moved {
  from = module.migrator
  to   = module.stack.module.migrator
}

moved {
  from = module.web
  to   = module.stack.module.web
}

moved {
  from = module.dns_api
  to   = module.stack.module.dns_api
}

moved {
  from = module.observability
  to   = module.stack.module.observability
}

moved {
  from = aws_cloudwatch_log_metric_filter.security_fail_open
  to   = module.stack.aws_cloudwatch_log_metric_filter.security_fail_open
}

moved {
  from = aws_cloudwatch_metric_alarm.security_fail_open
  to   = module.stack.aws_cloudwatch_metric_alarm.security_fail_open
}
// ── Adopt the Cloudflare Tunnel that already exists ──────────────────────────
// rally-develop was created in the dashboard before the cf-tunnel module existed. This
// block hands it to Terraform instead of creating a second one.
//
// The plan MUST read "1 to import, 0 to change, 0 to destroy" for this resource. A
// change here would rotate the tunnel's secret, which rotates the connector token, and
// every running cloudflared would hold one that no longer authenticates — the API would
// be unreachable until the next deploy shipped the new value. The module ignores
// `secret` so that cannot happen; confirm it in the plan anyway.
//
// Safe to delete once applied: an import block whose target is already in state is a
// no-op.
import {
  to = module.stack.module.tunnel[0].cloudflare_zero_trust_tunnel_cloudflared.this
  # "<account id>/<tunnel uuid>", not the bare UUID: the provider rejects a bare id
  # with `invalid id … should be in format "accountID/argoTunnelUUID"`.
  id = "${var.cloudflare_account_id}/7134b087-ee8f-4768-907a-845fa8eaa692"
}
