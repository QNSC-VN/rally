# Runbook — bundling app secrets into one Secrets Manager container

Secrets Manager bills **$0.40 per secret per month regardless of size**. This stack
creates 12 app secrets per environment holding ~2.4 KB in total, against a 64 KB
per-secret limit. Collapsing them into one JSON object read per key by ECS is the same
material for one container's fee.

Develop completed this on 2026-08-01 (#313 + follow-up). Production is still standalone.

## What ECS actually reads

A bundled reference is the `<arn>:<key>::` form of `valueFrom`:

```
arn:aws:secretsmanager:ap-southeast-1:608983206583:secret:rally/develop/app-bH4nIC:jwt-private::
```

Call sites do not change — `module.secrets.secret_arns["jwt-private"]` returns a
standalone ARN or a bundle key reference depending on `use_bundle` alone.

## The four steps, and why they are separate

The dangerous ordering is switching the references and destroying the old secrets in one
apply: if the bundle is wrong, the values it replaced are already gone. Develop sets
`recovery_window_days = 0`, so gone means gone.

| step | change in `infra/live/<env>/main.tf` | effect |
|---|---|---|
| 1 | `secrets_bundle_name = "app"` | creates the bundle EMPTY; nothing reads it |
| 2 | *(none — out of band)* | populate it from the standalone values |
| 3 | `secrets_use_bundle = true`<br>`secrets_create_standalone = true` | references cut over, old secrets RETAINED |
| 4 | drop `secrets_create_standalone` | old secrets destroyed, saving lands |

Only step 3 can fail, and it fails safely: a missing or misspelled key means the task
cannot boot, the rollout never reaches steady state, and the previous task definition
still points at secrets that still exist. Rollback at that point is reverting one line.

**Between steps 3 and 4 the environment bills one MORE container than before** (13, not
12) because both sets exist. The saving only arrives at step 4.

## Step 2 — populating the bundle

`docs/runbooks/bundle-secrets.sh` does this without the values ever becoming a shell
variable, a command argument, or terminal output. It reads the key list from the
bundle's own description (which Terraform generates from `secret_names`), so it follows
the module rather than carrying a second copy of the list.

```bash
export AWS_PROFILE=qnsc-admin AWS_REGION=ap-southeast-1
./docs/runbooks/bundle-secrets.sh develop          # assemble and write
./docs/runbooks/bundle-secrets.sh develop --verify # sha256 per key vs standalone
```

Output is key names and lengths only. `--verify` compares each bundled key against its
standalone counterpart by sha256 and exits non-zero on any mismatch.

**Run `--verify` before setting `use_bundle`.** This is not optional diligence — see the
CI gap below.

## The CI gap this covers

The `qnsc-ci` deploy preflight rejoins the first seven colon-separated ARN fields, so it
correctly probes the *container* behind a bundled reference. But it only proves the
container is **non-empty** — not that every referenced key exists inside it.

So a bundle missing one key **passes CI and fails at task boot**. That is strictly less
than standalone secrets caught, where each container was probed individually. The
sha256 verify above is what closes it.

It still fails safely (failed rollout, previous task definition intact), but budget for
a failed deploy rather than a clean gate.

## What bundling gives up

**Per-secret IAM.** IAM cannot scope below a secret, so a bundle is granted whole or not
at all. The api task role's two-secret runtime grant widens to every key in the object.
Accepted here because the *execution* role already reads the full set from the same
task, so nothing becomes reachable that was not already.

Keep a value **out** of the bundle if it needs its own resource policy, its own rotation
schedule, or a narrower reader than the rest. The module supports a mixed set.

**Per-secret rotation.** One key rotating rewrites the whole object as a new version.
None of these rotate — they are minted in other systems (Entra, GitHub, Cloudflare R2) —
so this does not bite today.

## Two traps in the Terraform

Both apply cleanly and fail later, so they are worth knowing before repeating this.

**`secret_arns` is not an IAM resource when bundled.** It returns `<arn>:<key>::`, which
is a `valueFrom` reference. An IAM statement built from it matches *nothing* while
applying successfully — surfacing as `unable to pull secrets` at boot, or as a silent
runtime failure on the task-role path that no deploy health check catches. Use container
ARNs for anything in a `resources =` position.

**`module.secrets.secret_iam_arns` fails the plan.** It is built from
`aws_secretsmanager_secret.*.arn`, unknown until apply — and `ecs-service` uses
`length(var.secret_arns)` in a `count`, which cannot be unknown. `local.secret_iam_arns`
in `infra/modules/stack/main.tf` derives the ARNs from *names* instead, keeping the
length static, with a trailing `-*` for the random 6-character suffix Secrets Manager
appends.

## Doing this for production

Production is idle pre-launch and its secrets will likely be re-pasted at go-live
anyway, so weigh ~$4.80/mo against the churn.

If you proceed, the sequence is identical, with two differences:

- `recovery_window_days = 30` in prod, so step 4 is recoverable for 30 days rather than
  never. That makes step 4 meaningfully safer than it was in develop.
- Prove all three consumers — api, worker **and** migrator — on the bundle via a real
  deploy before step 4. In develop the migrator was only exercised because a normal
  merge happened to run it.

## Rolling back

**Before step 4:** revert `secrets_use_bundle` to `false`, apply, redeploy. The
standalone secrets still hold their values.

**After step 4 in develop:** the containers are gone, not scheduled for deletion.
Recreate them (`secrets_create_standalone = true`) and re-paste all 12 values by hand.
The bundle is the only copy of that material — do not delete it casually.
