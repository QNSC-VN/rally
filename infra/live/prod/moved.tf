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
  from = module.messaging
  to   = module.stack.module.messaging
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
