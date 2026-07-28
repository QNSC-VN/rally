# Cutting the app over to least-privilege database roles

**Status:** roles exist, cutover NOT done.
**Owner:** whoever runs the next infra change.

## Why

`infra/modules/stack/main.tf` wires `DATABASE_USER` / `DATABASE_PASSWORD` from
`module.rds.master_secret_arn` for **all three** workloads — api (line ~239),
worker (~388) and migrator (~510). So every HTTP request runs as the RDS master
role, which owns every table in the database. Two consequences:

1. **Blast radius.** An injection or a bad migration path has `DROP TABLE`
   rights on production data during ordinary request handling.
2. **Any future RLS is inert.** Postgres exempts a table's owner from row-level
   security unless `FORCE ROW LEVEL SECURITY` is also set. This is not
   hypothetical here: it is precisely why the RLS layer added in migration
   `0005` never enforced anything, recorded as the audit's top finding in
   `docs/superpowers/specs/2026-07-09-drop-multi-tenant-merge-into-workspace-design.md`.

Migration `0068_app_role_least_privilege.sql` has already created the roles and
their grants. It created them **NOLOGIN**, so nothing uses them yet and applying
it changed no running behaviour. This runbook is the part that does.

| Role | Rights | Used by |
|---|---|---|
| `rally_app` | `SELECT, INSERT, UPDATE, DELETE` on the nine app schemas. No DDL, no ownership. | api |
| `rally_worker` | Same as `rally_app`. Separate identity so worker traffic is attributable and can diverge later. | worker |
| `rally_migrate` | `ALL` on the app schemas plus `drizzle`. Owns the schema after step 4. | migrator only |

The application code needs no change: `db/migrate.ts` already prefers
`DATABASE_MIGRATION_URL` over `DATABASE_URL` (`db/database-url.ts:84`), and
`.env.example` already names `rally_app` and `rally_migrate` for local dev. Only
the credentials handed to each task change.

## What already proves the grants are complete

`backend-ci.yml` runs `scripts/ci/enable-least-privilege-role.mjs` before the e2e
job, then runs **the entire e2e suite as `rally_app`** rather than as the
superuser every other job uses. So a schema, table or sequence that migration
0068 forgot to `GRANT` fails CI — not the production cutover. The script also
asserts the role *cannot* run DDL, so widening the grants to ownership fails too.

Verified locally at the time of writing: 865 unit tests and 133 e2e tests pass
with `DATABASE_URL` pointing at `rally_app`, with no `permission denied`. `pnpm
db:seed` also works as `rally_app`; `db/truncate-all.ts` deliberately uses
`resolveMigrationUrl()` because `TRUNCATE` is an owner right.

To run locally the way CI and post-cutover production do:

```sql
ALTER ROLE rally_app LOGIN PASSWORD 'rally_app';
```
```bash
# .env — app as the restricted role, migrations as the owner
DATABASE_URL=postgresql://rally_app:rally_app@localhost:5432/rally_dev?sslmode=disable
DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/rally_dev?sslmode=disable
```

## Cutover

Do this in **develop first**, leave it a full deploy cycle, then prod.

### 0. What Terraform already contains

`infra/modules/stack` is already wired for this, switched off:

- `secret_names` gains `db-app-password` and `db-worker-password`. Following the
  existing convention in that map, Terraform creates them **empty** — the value
  never enters state.
- `var.db_least_privilege` (**default `false`**) selects, via
  `local.api_db_secrets` / `local.worker_db_secrets`, whether api and worker take
  their credentials from the RDS master secret or from the new ones.
- The migrator is untouched by the flag; it keeps the master credential because
  it needs DDL.

So applying the current code creates two empty secrets and changes no running
task. Everything below is the deliberate part.

### 1. Put a password in each secret

In the Secrets Manager console, set a value on `<product>/<env>/db-app-password`
and `<product>/<env>/db-worker-password`. Plain string, not JSON — the module
injects the whole secret as `DATABASE_PASSWORD`, and `DATABASE_USER` travels as
plain env (`rally_app` is an identifier, not a credential).

Use `[A-Za-z0-9_-]` only. `db/database-url.ts` composes a DSN from the parts, and
avoiding `@ : / ?` sidesteps URL-encoding entirely.

> Do not hand-write these passwords into `.env`, CI, or a task definition. The
> deploy preflight in qnsc-ci already refuses to deploy while an injected secret
> is still empty, which is what makes step 3 fail loudly rather than silently.

### 2. Grant LOGIN

Connect as the RDS master and, for each environment:

```sql
ALTER ROLE rally_app    LOGIN PASSWORD '<from secrets manager>';
ALTER ROLE rally_worker LOGIN PASSWORD '<from secrets manager>';
```

Verify the role is not privileged and cannot escalate:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname LIKE 'rally%';
-- rally_app / rally_worker: rolcanlogin=t and every other column MUST be f
```

Then prove the grant actually works before pointing anything at it:

```sql
SET ROLE rally_app;
SELECT count(*) FROM work.work_items;          -- must succeed
CREATE TABLE work.should_fail (id int);        -- must fail: permission denied
RESET ROLE;
```

### 3. Flip the flag

One line in `infra/live/<env>/main.tf`, inside `module "stack"`:

```hcl
db_least_privilege = true
```

Apply. The execution role already has `GetSecretValue` on the new secrets —
`secret_arns` passes `values(module.secrets.secret_arns)` wholesale, so they were
covered the moment they were added to `secret_names`.

**Order matters and Terraform cannot enforce it.** Steps 1 and 2 must be done in
this environment first. Flip the flag against a role that has no password and the
tasks boot, fail to authenticate (`28P01`), and roll back.

**Leave the migrator on master.** Changing the runtime and the migrator in one
deploy means a failure cannot be attributed to either.

Watch for `permission denied for …` in CloudWatch. CI runs the whole e2e suite as
`rally_app` (see below), so a gap here is unlikely — but if one appears it means
migration 0068's `app_schemas` array missed a schema. Grant it and move on; that
is not a reason to revert the whole change.

### 4. Transfer ownership to `rally_migrate` (optional, do later)

Only needed if RLS is ever adopted, or to stop the migrator running as master.
Ownership transfer is the disruptive part, so it is deliberately not bundled
with steps 1–3.

```sql
REASSIGN OWNED BY <master_username> TO rally_migrate;
```

Then repeat step 3 for the migrator task, pointing it at a `rally_migrate`
secret. After this, `rally_app` is a non-owner and `FORCE ROW LEVEL SECURITY`
would no longer be required for policies to bite — see the RLS discussion in
`RALLY_HARDENING_PLAN.md` before going further.

## Rollback

Set `db_least_privilege = false` and apply. The master credential is untouched
throughout and the app holds no state tied to the role it connected as, so this
is a task-definition revision and a rolling restart — nothing more. The secrets
and the roles can stay; they are inert while the flag is off.

To retire the roles entirely:

```sql
ALTER ROLE rally_app NOLOGIN;
ALTER ROLE rally_worker NOLOGIN;
-- and only if you also want them gone:
-- REVOKE ALL ON ALL TABLES IN SCHEMA work FROM rally_app;  -- …per schema
-- DROP ROLE rally_app;
```

Step 4 is the one that is awkward to undo — `REASSIGN OWNED BY` back to the
master role works, but do it in a maintenance window.

## Verifying afterwards

```sql
-- Who is the app actually connecting as?
SELECT usename, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1;
-- Expect rally_app / rally_worker, and the master only during a migration.
```
