output "ecr_repository_urls"   { value = module.ecr.repository_urls }
output "ecr_push_role_arn"     { value = module.iam_oidc.ecr_push_role_arn }
output "deploy_role_arns"      { value = module.iam_oidc.deploy_role_arns }
output "infra_plan_role_arn"   { value = module.iam_oidc.infra_plan_role_arn }
output "infra_apply_role_arn"  { value = module.iam_oidc.infra_apply_role_arn }
output "web_deploy_role_arns"  { value = module.iam_oidc.web_deploy_role_arns }

# Platform outputs (re-exported for convenience so env stacks can read from
# _shared remote state instead of directly from qnsc-infra)
output "kms_key_arn" {
  value       = data.terraform_remote_state.platform.outputs.kms_key_arn
  description = "Shared CMK ARN from qnsc-infra — pass to RDS and Secrets modules"
}
output "artifacts_bucket_name" {
  value       = data.terraform_remote_state.platform.outputs.artifacts_bucket_name
  description = "Shared artifacts bucket from qnsc-infra — use in publish-openapi-spec CI"
}
output "cloudflare_zone_id" {
  value       = try(data.terraform_remote_state.platform.outputs.cloudflare_zone_id, "")
  description = "Cloudflare Zone ID for qnsc.vn from qnsc-infra — env stacks pass to the dns-record module"
}
output "cloudflare_ipv4" {
  value       = try(data.terraform_remote_state.platform.outputs.cloudflare_ipv4, [])
  description = "Cloudflare IPv4 ranges from qnsc-infra — prod stacks use for ALB ingress allow-list"
}
