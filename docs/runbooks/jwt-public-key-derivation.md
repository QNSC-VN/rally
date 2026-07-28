# Runbook — retire the stored JWT public key

`JWT_PUBLIC_KEY` is now **derived** from `JWT_PRIVATE_KEY` at boot (`env.schema.ts`), so
the stored `jwt-public` secret is redundant. This is the checklist for removing it safely,
in that order: ship the derivation, verify it, *then* delete.

**Why it goes:** an ES256 public key is a pure function of its private key, and rally
publishes no JWKS — there is no verifier anywhere that lacks the private half. Both use
sites (`platform.module.ts`, `jwt.strategy.ts`) run in the process that signs.

**Why that matters more than the $0.40/mo:** storing both halves allowed the one failure a
key pair cannot otherwise have — a **mismatched pair**. Signing succeeds, every
verification rejects, all authentication fails. Nothing detected it, because each value was
individually valid to Terraform, to the deploy preflight and to the env schema. Nobody
checked that they *matched*. Derivation removes the possibility rather than monitoring for
it.

The schema also now rejects two adjacent mistakes at boot: a public key pasted into
`JWT_PRIVATE_KEY` (`createPrivateKey` is called first, precisely because `createPublicKey`
accepts a public key and hands it back), and a key on any curve other than P-256, which
would sign happily and produce tokens every verifier rejects.

## Phase 1 — ship the derivation (done)

`JWT_PUBLIC_KEY` is optional in the schema and derived when absent. **An explicitly
supplied value still wins**, and infra still supplies one, so this phase changes nothing
observable. That is the point: it is safe to deploy on its own.

## Phase 2 — DONE (injection removed)

The two `{ name = "JWT_PUBLIC_KEY", ... }` entries are gone from the api and worker
`secrets` blocks, so both services now derive the key. The secret still exists, which is
what keeps a revert cheap: revert the commit, re-apply, and the value is still there.

Before this landed, both environments' `jwt-private` were checked against the exact
validation the schema performs — `createPrivateKey`, `asymmetricKeyType == 'ec'`,
`namedCurve == 'prime256v1'`, then `createPublicKey` — and both passed:

```
develop      PASS: ec/prime256v1, public key derives
production   PASS: ec/prime256v1, public key derives
```

### Verify after the develop deploy

**Locally**, comment `JWT_PUBLIC_KEY` out of `.env` and run the API:

```bash
pnpm start:dev
```

Boot must succeed. Then get a bearer token and call an authenticated endpoint with it —
this is the check that matters, because it exercises sign *and* verify with the derived
key. A mismatch would show as a 401 on a token the same process just issued.

Develop picks this up on merge to `main`. Production picks it up on the next `v*.*.*`
tag — so **let the develop deploy go green before tagging**, which makes develop the canary
the pipeline is designed to be. Then:

```bash
aws ecs update-service --cluster rally-develop --service rally-develop-api    --force-new-deployment --region ap-southeast-1
aws ecs update-service --cluster rally-develop --service rally-develop-worker --force-new-deployment --region ap-southeast-1
aws ecs wait services-stable --cluster rally-develop \
  --services rally-develop-api rally-develop-worker --region ap-southeast-1
```

Sign in at `https://rally-dev.qnsc.vn`, reload, and confirm the session survives. Then
check the worker booted — it validates the same schema, so a derivation failure there
shows as a crash loop rather than a login error:

```bash
aws logs tail /ecs/rally-develop-worker --since 10m --region ap-southeast-1 \
  --filter-pattern 'JWT_PRIVATE_KEY'
```

Empty output is the pass. Any hit is the schema rejecting the key — read the message, it
names the reason.

**Rollback at this point is free**: revert the commit and re-apply. The secret still
exists and still holds the value.

## Phase 3 — delete the secret (DONE)

The `"jwt-public"` entry is gone from `secret_names`, so Terraform destroys the secret in
both environments. Phase 2 was verified in develop AND production first — task definitions
carried no `JWT_PUBLIC_KEY`, both services logged `Nest application successfully started`,
and neither log group contained a `JWT_PRIVATE_KEY` complaint.

Plans reviewed before merge: develop `1 to destroy` (the secret); production `4 to destroy`,
which is the secret plus three task-definition **replacements** — Terraform counts a
replacement as a destroy plus an add, so that number is expected rather than alarming.

### Original procedure, kept for reference

Only after develop has run on derivation for a few deploys, and production has been
through phase 2 as well.

1. Remove the `"jwt-public"` entry from `secret_names` in
   `infra/modules/stack/main.tf`, along with the PENDING REMOVAL comment block.
2. Apply develop, then production.
3. Confirm it is gone from both:

```bash
for e in develop production; do
  aws secretsmanager describe-secret --secret-id "rally/$e/jwt-public" \
    --region ap-southeast-1 --query 'Name' --output text 2>&1 | tail -1
done
```

`ResourceNotFoundException` on both is the pass. Develop was created with
`recovery_window_days = 0`, so deletion there is immediate and irreversible; production
keeps a 30-day recovery window, during which `aws secretsmanager restore-secret` would
bring it back.

Terraform's own deletion is enough — nothing else references the secret.

## Do not

- **Do not set `JWT_PUBLIC_KEY` in infra again.** It would silently take precedence over
  derivation and reintroduce the mismatch risk, with no test able to see it.
- **Do not rotate `jwt-private` during phases 1–2.** While both values exist, rotating one
  and not the other is exactly the mismatch this change eliminates. After phase 3, rotating
  the private key is a single-value operation and the public half follows automatically —
  which is the other reason to finish this.
