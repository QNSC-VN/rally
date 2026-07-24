# IaC — task-role runtime access to broker secrets (AWS Secrets Manager)

**Date:** 2026-07-24 · **Status:** Implemented (this PR + qnsc-tf-modules#30)

**Why:** the multi-IdP broker resolves per-connection OIDC client secrets **at
runtime** — a connection is a DB row (`sso_connections`) that references a
secret. Today only the **execution** role can read secrets (boot-time env
injection via `secret_arns`); the **task** role (runtime) has messaging + S3
only. This adds a scoped runtime read.

Spans two repos: **`qnsc-tf-modules`** (shared `ecs-service` module) and this
repo (**`infra/live/{develop,prod}`**).

---

## 1. `qnsc-tf-modules` — `modules/ecs-service` (PR #30 → `ecs-service-v1.4.0`)

New optional input `task_secret_arns`. When non-empty, the **task** role gets a
`task-secrets-access` policy: `secretsmanager:GetSecretValue` on those ARNs
(wildcards allowed) + `kms:Decrypt` on the CMK when `kms_key_arn` is set.
Mirrors the existing `task_s3` / `execution_secrets` patterns; count-gated so
the default `[]` is a no-op for every current consumer. release-please cuts
**`ecs-service-v1.4.0`** (minor, backward-compatible).

---

## 2. `infra/live/{develop,prod}/main.tf` (this PR)

### `module "api"` + `module "worker"` — bump the module ref
`ecs-service-v1.3.0` → `ecs-service-v1.4.0` (additive; worker gets no new
inputs, bumped only for version parity).

### `module "api"` — grant the task role + set the ref env
```hcl
  # Task role reads per-connection OIDC client secrets at runtime.
  task_secret_arns = [
    module.secrets.secret_arns["entra-client-secret"],
    "arn:aws:secretsmanager:${local.region}:${data.aws_caller_identity.current.account_id}:secret:rally/${local.env}/sso/*",
  ]

  environment_vars = concat(…, [
    { name = "IDENTITY_HOME_SECRET_REF", value = module.secrets.secret_arns["entra-client-secret"] },
    # IDENTITY_REDIRECT_URI omitted — code defaults to ENTRA_REDIRECT_URI.
  ])
```

**Design note — the home connection reuses `entra-client-secret`.** The home
connection *is* the company's Entra app, so it shares that app's existing
client secret. We deliberately do **not** create a separate `sso/home` copy:
`entra-client-secret` is still injected at boot for the legacy `GET /bff/login`
flow (until T18), and a second copy of the same value is the exact stale-copy
footgun the `db-url` → RDS-managed-secret migration removed. `IDENTITY_HOME_SECRET_REF`
therefore points at the existing secret's ARN, and `GetSecretValue` accepts an
ARN as `SecretId`.

`kms_key_arn` is already passed to `module "api"` (shared CMK), so `kms:Decrypt`
resolves. Runtime reads use the same Secrets Manager path as the execution-role
boot reads.

---

## 3. Out-of-band (per the "empty secret, value out-of-band" convention)
- **Home connection:** nothing extra — `entra-client-secret` already holds the
  value. Once `IDENTITY_HOME_SECRET_REF` is set and the app redeploys, the seed
  provisions the home connection as a broker `directory` connection.
- **Add a vendor connection later:** create `rally/${env}/sso/<slug>` in Secrets
  Manager, set its value, then insert the `sso_connections` row referencing it
  — **no TF change** (covered by the `sso/*` wildcard grant).

## 4. Verify
- CMK key policy delegates to IAM (or explicitly allows the api **task** role)
  so `kms:Decrypt` is permitted — check `qnsc-infra` bootstrap.
- After deploy: the task can `GetSecretValue` for `entra-client-secret` and the
  `rally/${env}/sso/*` prefix, and *only* those (least privilege); the
  execution-role boot secrets grant is unchanged.

## 5. Ordering
`qnsc-tf-modules#30` must merge (→ `ecs-service-v1.4.0` tag) **before** this
PR's `terraform init` can resolve the module. Apply develop → verify broker
home login → prod.

## 6. Least-privilege / rotation
- Task role: `GetSecretValue` limited to `entra-client-secret` + `rally/${env}/sso/*`
  (not the JWT/CSRF/RDS boot secrets, which stay execution-role only).
- Rotation is manual for now; the resolver's 5-min TTL picks up a new value.
  Automatic rotation is a separate hygiene follow-up.
