terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
    # For the SES domain's DKIM records. The zone (`qnsc.vn`) is Cloudflare-managed and its id
    # arrives from the platform remote state below, so the records that PROVE the identity can be
    # created beside it rather than pasted by hand.
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.0" }
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
  # `try(..., "")` for the same reason `outputs.tf` uses it: an account whose DNS is not
  # Cloudflare-managed yet still has to be able to apply this stack.
  cloudflare_zone_id = try(data.terraform_remote_state.platform.outputs.cloudflare_zone_id, "")
}

# Token from `CLOUDFLARE_API_TOKEN` in CI (never committed), mirroring `infra/live/*/main.tf`. `null`
# rather than `""` when unset: an empty string is a credential the provider would try and fail with,
# where `null` lets it fall back to the environment.
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
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


# ── Outbound email (SES) ──────────────────────────────────────────────────────
#
# WHY THIS LIVES IN THE SHARED LAYER, NOT IN AN ENV STACK
# An SES identity is per (account, region), and `develop` and `prod` share both — same account, same
# `ap-southeast-1`, same `qnsc.vn` zone. Two env stacks each declaring `qnsc.vn` would be two states
# fighting over one resource, and the DKIM CNAMEs would collide in the zone as well. So the identity
# is created ONCE here and the env stacks only take the IAM permission to send through it.
#
# WHAT WAS BROKEN BEFORE THIS
# `EMAIL_PROVIDER=ses` and `MAIL_FROM_EMAIL` were wired in both environments, and neither of the two
# things a send actually needs existed: no verified identity, and no `ses:SendEmail` on any task role.
# Every invitation and notification therefore failed, three failures opened the in-process email
# circuit breaker, and the API went on reporting healthy — a silent outage of the one flow that
# onboards every user. `mail_from_email`'s own variable docs already warned that Terraform could not
# check the identity for you; now it creates it.
#
# A DOMAIN identity, not an email one, deliberately: an email identity is verified by a human
# clicking a link AWS mails to that address, which cannot be automated and has to be repeated per
# sender. A domain verifies once, covers every `@qnsc.vn` sender both environments use, and carries
# DKIM signing, which is what keeps the mail out of spam folders.
#
# NOT HANDLED HERE, AND IT CANNOT BE: the SES SANDBOX. A new account may only send to VERIFIED
# recipients, so invitations to a colleague's address are refused no matter how correct this is.
# Check with `aws sesv2 get-account --query ProductionAccessEnabled`; leaving the sandbox is a support
# request, not a resource.
resource "aws_sesv2_email_identity" "mail_domain" {
  email_identity = var.mail_domain

  dkim_signing_attributes {
    # AWS-managed keys (Easy DKIM). The alternative is BYODKIM, which means holding a private key in
    # state or a secret for no gain here.
    next_signing_key_length = "RSA_2048_BIT"
  }
}

/**
 * The three CNAMEs that prove the domain. Without them the identity stays `PENDING` forever and every
 * send is refused, so they belong in the same apply as the identity rather than in a runbook step.
 *
 * `count` guards on the zone id: `_shared` reads it from the platform state with a `try(..., "")`, so
 * an environment whose DNS is not Cloudflare-managed degrades to "identity created, records to be
 * added by hand" instead of failing the apply.
 */
resource "cloudflare_record" "ses_dkim" {
  count = local.cloudflare_zone_id != "" ? 3 : 0

  zone_id = local.cloudflare_zone_id
  name    = "${aws_sesv2_email_identity.mail_domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey"
  type    = "CNAME"
  value   = "${aws_sesv2_email_identity.mail_domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  # Never proxied: DKIM is a DNS lookup by a receiving mail server, not HTTP traffic. Proxying it
  # would return Cloudflare's own record and the verification would never complete.
  proxied = false
  ttl     = 300

  comment = "SES DKIM for ${var.mail_domain} (managed by rally-infra _shared)"
}


/**
 * A custom MAIL FROM domain, so SPF ALIGNS as well as DKIM — on a SUBDOMAIN, deliberately.
 *
 * WHY NOT THE APEX. `qnsc.vn` already publishes `v=spf1 include:spf.protection.outlook.com -all` for
 * Microsoft 365, and a domain may carry only ONE SPF record: "adding SES to SPF" would mean editing
 * the record every piece of company mail depends on, ending in a hard `-all`. The benefit would be
 * zero, because DMARC passes when EITHER mechanism aligns and our DKIM already signs with
 * `d=qnsc.vn`. So the apex is left alone and the envelope sender moves to `mail.qnsc.vn`, which only
 * SES uses.
 *
 * `_dmarc.qnsc.vn` already exists (`v=DMARC1; p=none; rua=mailto:quangld@qnsc.vn`) and is NOT managed
 * here: it governs M365 mail too, and tightening `p=` is the domain owner's decision, not this
 * stack's.
 *
 * WHAT IT BUYS. Without this, SES sends with an envelope sender under `amazonses.com`, so a receiver
 * checking SPF sees Amazon's domain rather than ours — SPF then cannot align for DMARC and DKIM is
 * carrying the result alone. With it, both align, which is what gets a young sending domain out of
 * spam folders faster.
 *
 * `USE_DEFAULT_VALUE` on MX failure is the safe direction: if the MX below is ever missing or
 * unresolvable, SES silently falls back to `amazonses.com` and mail still goes out. `REJECT_MESSAGE`
 * would turn a DNS problem into an outage of every invitation.
 */
resource "aws_sesv2_email_identity_mail_from_attributes" "mail_domain" {
  email_identity         = aws_sesv2_email_identity.mail_domain.email_identity
  mail_from_domain       = "mail.${var.mail_domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

/**
 * The two records the custom MAIL FROM needs, on the subdomain only.
 *
 * The MX host is REGION-SPECIFIC (`feedback-smtp.<region>.amazonses.com`) — it is where SES asks
 * receivers to send bounces, so a wrong region silently loses them.
 */
resource "cloudflare_record" "ses_mail_from_mx" {
  count = local.cloudflare_zone_id != "" ? 1 : 0

  zone_id  = local.cloudflare_zone_id
  name     = "mail"
  type     = "MX"
  value    = "feedback-smtp.${var.mail_region}.amazonses.com"
  priority = 10
  ttl      = 300
  comment  = "SES custom MAIL FROM (bounce path) — managed by rally-infra _shared"
}

resource "cloudflare_record" "ses_mail_from_spf" {
  count = local.cloudflare_zone_id != "" ? 1 : 0

  zone_id = local.cloudflare_zone_id
  name    = "mail"
  type    = "TXT"
  # `~all`, not `-all`: this subdomain is new and only SES sends from it, but a softfail cannot turn a
  # misconfiguration into silently discarded mail while the setup settles.
  value   = "v=spf1 include:amazonses.com ~all"
  ttl     = 300
  comment = "SES custom MAIL FROM SPF — managed by rally-infra _shared"
}
