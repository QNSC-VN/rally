// Adoption of the RDS log group RDS created for itself.
//
// WHY THIS EXISTS. rds v2.1.0 started declaring the log groups that
// `enabled_cloudwatch_logs_exports` produces, so retention is a decision in code rather
// than the "never expires" RDS leaves behind. But RDS created this group itself, on the
// instance's first write, long before Terraform knew about it — so the first apply that
// consumes v2.1.x fails:
//
//     Error: creating CloudWatch Logs Log Group (/aws/rds/instance/rally-prod/postgresql):
//     ResourceAlreadyExistsException
//
// develop was adopted with `tofu import` from a workstation. Production could not be:
// this stack's Cloudflare token and account id reach CI and not a laptop, so a local
// plan resolves count-gated resources to unknown and dies with "Invalid count argument"
// before it can import anything. Chasing a real token onto a laptop to run a one-off
// against production is the wrong trade — see live/*/variables.tf on why values that
// reach apply but not plan make a plan lie.
//
// An `import` block runs the adoption inside the apply job, which HAS those values. It is
// also reviewable, unlike a command someone typed once.
//
// SAFE TO DELETE once apply-prod has run: the block is a one-time instruction, and after
// the group is in state it plans as a no-op. Left in place it is harmless but misleading.
//
// The matching `upgrade` group is deliberately absent — it does not exist on this
// instance, which has never been upgraded, so the apply creates it normally.
import {
  to = module.stack.module.rds.aws_cloudwatch_log_group.logs["postgresql"]
  id = "/aws/rds/instance/rally-prod/postgresql"
}
