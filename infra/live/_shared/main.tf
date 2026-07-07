terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    bucket         = "qnsc-tofu-state"
    key            = "rally/shared/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    dynamodb_table = "qnsc-tofu-locks"
  }
}

provider "aws" {
  region = "ap-southeast-1"
  default_tags {
    tags = {
      Project   = "rally"
      ManagedBy = "opentofu"
      Layer     = "shared"
    }
  }
}

locals {
  github_org = var.github_org
}

data "aws_caller_identity" "current" {}

# ── Read shared platform outputs from qnsc-infra bootstrap ───────────────────
# Gives us: kms_key_arn, artifacts_bucket_name, oidc_provider_arn
# Dependency: qnsc-infra/live/bootstrap must be applied before this stack.
data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = "qnsc-tofu-state"
    key    = "platform/bootstrap/terraform.tfstate"
    region = "ap-southeast-1"
  }
}


# ── ECR Repositories ──────────────────────────────────────────────────────────
module "ecr" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecr?ref=ecr-v1.1.0"

  repository_names     = ["rally-api", "rally-worker", "rally-migrator"]
  image_tag_mutability = "MUTABLE" # allows re-tagging :latest
  kms_key_arn          = data.terraform_remote_state.platform.outputs.kms_key_arn
  tags                 = { Layer = "shared" }
}

# ── GitHub OIDC ───────────────────────────────────────────────────────────────
# Owns ALL rally deploy roles: API (per-env), ECR push, infra plan/apply, AND
# the web (SPA) deploy roles (previously hand-rolled below — now the module's
# web_deploy_environments input). Web bucket names keep "rally-web-*" naming
# (unrelated to the monorepo — S3 names are free-form and already live).
module "iam_oidc" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/iam-oidc?ref=iam-oidc-v1.2.0"

  product           = "rally"
  github_org        = local.github_org
  oidc_provider_arn = data.terraform_remote_state.platform.outputs.oidc_provider_arn

  environments = {
    develop = {
      allowed_subjects = [
        "repo:${local.github_org}/rally:ref:refs/heads/main",
        "repo:${local.github_org}/rally:environment:develop"
      ]
    }
    production = {
      allowed_subjects = [
        "repo:${local.github_org}/rally:ref:refs/heads/main",
        "repo:${local.github_org}/rally:ref:refs/tags/v*",
        "repo:${local.github_org}/rally:environment:production"
      ]
    }
  }

  web_deploy_environments = {
    develop = {
      allowed_subjects = [
        "repo:${local.github_org}/rally:ref:refs/heads/main",
        "repo:${local.github_org}/rally:environment:develop",
      ]
      s3_bucket = "rally-web-develop"
    }
    production = {
      allowed_subjects = [
        "repo:${local.github_org}/rally:ref:refs/heads/main",
        "repo:${local.github_org}/rally:ref:refs/tags/v*",
        "repo:${local.github_org}/rally:environment:production",
      ]
      s3_bucket = "qnsc-rally-web-prod" # "rally-web-prod" is globally claimed by another AWS account
    }
  }

  app_repo_names         = ["rally"] # monorepo: was rally-api
  infra_repo_name        = "rally"   # monorepo: infra lives in rally/infra/
  ecr_repository_pattern = "rally-*"
  ecs_passrole_pattern   = "rally-*" # shared ecs-service names roles <cluster>-<service>-task
  tags                   = { Layer = "shared" }
}

# ── RDS dev-cost-saver guard — develop deploy role only ──────────────────────
# Allows the CI deploy job to detect + start a stopped RDS instance before
# running migrations. Scoped to develop only; prod RDS is always-on and this
# permission is intentionally absent from the production deploy role.
#
# The ARN is constructed directly (account_id + region + fixed identifier)
# instead of via a `data "aws_db_instance"` lookup. A data-source lookup
# fails hard whenever the instance doesn't exist yet or has been torn down
# (e.g. a fresh deploy, or a full teardown+redeploy cycle) — this stack
# would then be unable to apply/destroy independently of develop's RDS
# lifecycle. An ARN string doesn't require the resource to exist.
locals {
  rally_develop_rds_arn = "arn:aws:rds:ap-southeast-1:${data.aws_caller_identity.current.account_id}:db:rally-develop"
}

resource "aws_iam_role_policy" "deploy_rds_dev_guard" {
  name = "rally-deploy-develop-rds-guard"
  role = split("/", module.iam_oidc.deploy_role_arns["develop"])[1]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RDSDevGuard"
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:StartDBInstance",
        ]
        Resource = local.rally_develop_rds_arn
      }
    ]
  })
}

# ── ECS deploy verification — both deploy roles ────────────────────────────
# verify-ecs-deploy enumerates running tasks (aws ecs list-tasks) to confirm the
# new image tag is live after a deploy. Without ecs:ListTasks the call is denied,
# the action swallows the error, and verification always times out. The baseline
# iam-oidc module (main / next release) grants this, but this stack still pins
# iam-oidc-v1.2.0 — adopting the newer module also changes the infra-apply OIDC
# trust, so we grant it here (both envs) until that bump is done deliberately.
resource "aws_iam_role_policy" "deploy_ecs_verify" {
  for_each = toset(["develop", "production"])

  name = "rally-deploy-${each.key}-ecs-verify"
  role = split("/", module.iam_oidc.deploy_role_arns[each.key])[1]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECSVerifyListTasks"
        Effect   = "Allow"
        Action   = ["ecs:ListTasks"]
        Resource = "*"
      }
    ]
  })
}





