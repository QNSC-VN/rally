output "alb_dns_name" { value = module.alb.dns_name }
output "ecs_cluster_name" { value = module.ecs_cluster.cluster_name }
output "ecs_api_service" { value = module.api.service_name }
output "ecs_worker_service" { value = module.worker.service_name }
output "rds_endpoint" { value = module.rds.endpoint }
output "cache_endpoint" { value = module.cache.endpoint }
output "secret_arns" { value = module.secrets.secret_arns }

# Web (Cloudflare Pages) outputs
output "web_pages_project" { value = try(module.web[0].project_name, null) }
output "web_custom_domain" { value = try(module.web[0].custom_domain, null) }
output "web_url" { value = try("https://${module.web[0].custom_domain}", null) }
