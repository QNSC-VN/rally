output "alb_dns_name" { value = module.alb.dns_name }
output "ecs_cluster_name" { value = module.ecs_cluster.cluster_name }
output "ecs_api_service" { value = module.api.service_name }
output "ecs_worker_service" { value = module.worker.service_name }
output "ecs_migrator_task_def" {
  value       = module.migrator.family
  description = "Migrator task definition family name — use with aws ecs run-task"
}
output "rds_endpoint" { value = module.rds.endpoint }
output "rds_master_secret_arn" { value = module.rds.master_secret_arn }
output "cache_endpoint" { value = module.cache.endpoint }
output "secret_arns" { value = module.secrets.secret_arns }
output "attachments_bucket" { value = aws_s3_bucket.attachments.bucket }

# Networking — needed for ECS run-task (migrator) and GitHub env vars
output "private_subnet_ids" { value = module.network.private_subnet_ids }
output "sg_app_id" { value = module.network.sg_app_id }

# Messaging — useful for verifying queue setup
output "sqs_queue_urls" { value = module.messaging.queue_urls }
output "sns_topic_arns" { value = module.messaging.topic_arns }

# Web (Cloudflare Pages) outputs — PAGES_PROJECT is published to GitHub env vars
# for the rally-web CI (wrangler --project-name).
output "web_pages_project" { value = try(module.web[0].project_name, null) }
output "web_custom_domain" { value = try(module.web[0].custom_domain, null) }
output "web_url" { value = try("https://${module.web[0].custom_domain}", null) }
