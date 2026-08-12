terraform {
  required_version = ">= 1.9"
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
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/ecr?ref=ecr-v2.0.0"

  # ecr-v2.0.0 splits the keep-count lifecycle rule by tag prefix. The single rule it
  # replaces was provably dead: `tagPrefixList` is AND, not OR, so one rule listing
  # ["sha-", "v"] only ever selected images carrying BOTH prefixes — the handful of
  # promoted releases — and never fired. Verified live: 105 `sha-` images sat under a
  # policy claiming to keep 30, so tagged history grew without bound.
  #
  # Defaults are keep 30 releases (v*) and keep 20 builds (sha-*). Previewed against the
  # live repositories before bumping: 180/178/173 images expire, of which ~90 each are
  # untagged and already expirable under the old policy, and ZERO carry a release tag or
  # `latest`. Re-run `aws ecr start-lifecycle-policy-preview` before changing these
  # counts — it is a dry run and it is the only way to see what a policy will delete.
  repository_names     = ["rally-api", "rally-worker", "rally-migrator"]
  image_tag_mutability = "MUTABLE" # allows re-tagging :latest
  kms_key_arn          = data.terraform_remote_state.platform.outputs.kms_key_arn
  tags                 = { Layer = "shared" }
}

# ── GitHub OIDC ───────────────────────────────────────────────────────────────
# Owns ALL rally AWS deploy roles: API (per-env), ECR push, infra plan/apply.
# The web SPA deploys to Cloudflare Pages (see live/*/main.tf module "web"), so
# it needs no AWS deploy role here.
module "iam_oidc" {
  source = "git::https://github.com/QNSC-VN/qnsc-tf-modules.git//modules/iam-oidc?ref=iam-oidc-v3.0.1"

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

  app_repo_names         = ["rally"] # monorepo: was rally-api
  infra_repo_name        = "rally"   # monorepo: infra lives in rally/infra/
  ecr_repository_pattern = "rally-*"
  ecs_passrole_pattern   = "rally-*" # shared ecs-service names roles <cluster>-<service>-task
  tags                   = { Layer = "shared" }

  # infra_plan_subjects / infra_apply_subjects: rally's infra-apply jobs run in
  # the shared/develop/production GitHub Environments (see infra-apply.yml), which
  # exactly match the module defaults — so no override is needed.

  # Blast-radius guardrail: explicit-Deny on the rally infra-apply role so a buggy
  # rally apply cannot destroy the platform's own foundations (state bucket, lock
  # table, OIDC provider, CMK) or mint IAM users — all of which are owned by
  # qnsc-infra bootstrap, never by rally.
  infra_apply_guardrail = {
    state_bucket_arn     = "arn:aws:s3:::qnsc-tofu-state"
    lock_table_arn       = "arn:aws:dynamodb:ap-southeast-1:${data.aws_caller_identity.current.account_id}:table/qnsc-tofu-locks"
    oidc_provider_arn    = data.terraform_remote_state.platform.outputs.oidc_provider_arn
    kms_key_arn          = data.terraform_remote_state.platform.outputs.kms_key_arn
    artifacts_bucket_arn = data.terraform_remote_state.platform.outputs.artifacts_bucket_arn
  }
}

# ── RDS wake guard — develop deploy role only ────────────────────────────────
# Allows the CI deploy job to detect + start a stopped RDS instance before running
# migrations. Scoped to develop only, and deliberately absent from the production
# deploy role.
#
# The STOPPING half exists too, which this comment used to deny. `idle_schedule` in
# infra/live/develop/main.tf creates three EventBridge schedules — rds-stop,
# api-scale-down, worker-scale-down — and CloudTrail confirms them firing nightly.
#
# So the two halves are a LOOP, and this grant is what closes it: the schedule stops
# develop at 21:00 and 03:00, and the next deploy's `ensure_rds` starts it again. That
# pairing is the whole cost posture, not a safety net for manual teardown.
#
# It also has to be understood as a loop to be reasoned about. The schedule ran nightly
# for weeks while develop stayed up 24/7, because a single 21:00 stop could not hold
# against a wake signal that fires whenever a deploy lands — measured 2026-08-02, fixed
# by adding a second 03:00 pass. Removing this grant does not save money; it breaks
# waking and leaves deploys failing against a stopped database.
#
# The ARN is constructed directly (account_id + region + fixed identifier)
# instead of via a `data "aws_db_instance"` lookup. A data-source lookup
# fails hard whenever the instance doesn't exist yet or has been torn down
# (e.g. a fresh deploy, or a full teardown+redeploy cycle) — this stack
# would then be unable to apply/destroy independently of develop's RDS
# lifecycle. An ARN string doesn't require the resource to exist.
locals {
  rally_develop_rds_arn = "arn:aws:rds:ap-southeast-1:${data.aws_caller_identity.current.account_id}:db:rally-develop"
  rally_prod_rds_arn    = "arn:aws:rds:ap-southeast-1:${data.aws_caller_identity.current.account_id}:db:rally-prod"
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

# ── RDS wake guard — PRODUCTION deploy role ──────────────────────────────────
# This grant was deliberately ABSENT until production was idled, and the reason it is
# here now is a posture change rather than a loosening: production's instance is
# STOPPED on purpose until go-live (see `min_count = 0` and `idle_schedule` in
# ../prod/main.tf), so waking it is a normal step of deploying rather than an
# exception to be denied.
#
# Without it, idling production silently broke the release pipeline: the deploy would
# reach `Run database migrations` and fail against a stopped instance, with the cause
# two repos away from the symptom. Two releases were cut the same day the idle landed,
# so this is not hypothetical.
#
# Still Start and Describe only — never Stop. Stopping is the scheduler's job and it
# has its own narrowly-scoped role; a deploy role that can stop production is a
# deploy that can cause an outage.
#
# REMOVE AT GO-LIVE together with the idle settings. Once production is meant to be
# running continuously, a deploy role able to start a stopped database is again the
# exception it used to be, and its absence is what makes an accidental stop loud.
resource "aws_iam_role_policy" "deploy_rds_prod_guard" {
  name = "rally-deploy-prod-rds-guard"
  role = split("/", module.iam_oidc.deploy_role_arns["production"])[1]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RDSProdWakeWhileIdled"
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:StartDBInstance",
        ]
        Resource = local.rally_prod_rds_arn
      }
    ]
  })
}

# NOTE: the former inline patches `deploy_ecs_verify` (ecs:ListTasks) and
# `ecr_push_describe_images` (ecr:DescribeImages) were removed when this stack
# adopted iam-oidc-v2.0.1 — the module now grants both permissions on the deploy
# and ecr-push roles respectively, so the module is once again the single source
# of truth for these roles.


