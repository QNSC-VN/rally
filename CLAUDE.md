# Rally — working notes

Conventions that already exist in this repo but are easy to miss, plus the
non-obvious tooling behaviour. Read this before changing build, auth, or DB code.

## Where the real documentation lives

| Topic | File |
|---|---|
| Frontend conventions (FSD layers, shared/ui, i18n) | `apps/web/FRONTEND_CONVENTIONS.md` |
| Entity surface pattern (list + detail scaffolds) | `apps/web/ADR-001-entity-surface-pattern.md` |
| Component migration state + ratchets | `apps/web/FRONTEND_COMPONENT_AUDIT.md` |
| Design specs and wave plans | `docs/superpowers/{specs,plans}/` |
| Auth model shared with opshub (+ what opshub must do) | `docs/superpowers/specs/2026-07-28-auth-convergence.md` |
| Declared differences from opshub | `docs/DIVERGENCE.md` |
| SCM (GitHub App) setup | `docs/scm-github-app.md` |

## Local stack

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + valkey + localstack
pnpm db:migrate                                  # applies migrations AND seeds
pnpm start:dev                                   # API with watch
pnpm --filter rally-web dev                      # SPA (proxies /v1 → API)
```

## Tooling behaviour that surprises people

- **`pnpm db:migrate` also seeds.** It runs the tenant bootstrap seed, not just
  migrations. `pnpm db:seed` runs the full demo seed on top. Both are idempotent.
- **Migrations are hand-written.** `drizzle-kit generate` needs a TTY and cannot
  run unattended, so `db/migrations/*.sql` are authored by hand and must match
  `db/schema/*`. CI proves a new migration applies on top of `main`'s schema, not
  just a fresh database — see the `migrations` job in `backend-ci.yml`.
- **`db/permissions.catalog.ts` is the single source of truth** for permission
  codes and role→permission mappings, imported via the `@db/*` path. It lives
  outside `libs/` because the standalone migrator image ships `db/**` only.
  `libs/shared-kernel/src/permissions.ts` re-exports it; two specs
  (`permissions.spec.ts`, `fe-permission-contract.spec.ts`) stop BE and FE drifting.
- **The built entrypoint is genuinely `dist/apps/api/apps/api/src/main.js`.** Nest
  emits one output tree whose common root is the repo root and rewrites path
  aliases to relative requires, so the nesting is what makes those resolve. Don't
  "fix" it — flattening breaks every emitted import.
- **Swagger is opt-in per environment.** `SWAGGER_ENABLED` (default `false`) serves
  `/api/docs`. It used to be derived from `NODE_ENV !== 'production'`, so anything
  not literally "production" published the endpoint inventory. CSP is now always on;
  the Swagger allowance is scoped to `scriptSrc` when that flag is set.
- **Coverage is a ratchet, not a target.** `vitest.config.ts` lists the files that
  have specs; `test/coverage-include.spec.ts` fails if a spec's subject is missing
  from that list or if the list names a deleted file. Raise the floors, never lower.
- **The frontend has ratchets too** (`apps/web/src/test/fe-consistency.ratchet.test.ts`):
  raw `<button>`, inline styles, hardcoded copy, file length, and CSRF headers on
  raw `fetch` writes. They may only decrease.
- **The SPA's API client is generated AND committed.** `apps/web/src/shared/api/generated/api.ts`
  comes from `/api/docs-json`, so any DTO change needs
  `pnpm --filter rally-web codegen` against a running local API, then a commit. The
  `OpenAPI contract` job regenerates from the spec it captured and diffs
  (`codegen:check`), so drift fails CI instead of failing at runtime.
- **`tsc -b` can pass on STALE build info.** Two things hid behind that in one session: an
  error code missing from the `ErrorCode` union, and a client that had never seen a new
  route (which surfaces only as `Cannot POST /v1/...` in the browser). When a change spans
  packages, verify with `tsc -b --force`.

## Reporting (Phase 6) — what is frozen, what is live

Four surfaces share one module (`libs/modules/reporting`) but not one data strategy, and the
difference is the whole design. Read this before changing a report or the snapshot job.

- **Burndown is FROZEN history; Velocity and Team Capacity are LIVE queries.** Task To Do is
  overwritten in place, so yesterday's remaining hours only exist if something wrote them
  down — hence `iteration_daily_snapshots`. Velocity deliberately has no snapshot: moving an
  item out of a closed iteration must change that bar. Never "unify" the two paths.
- **The snapshot cron runs HOURLY and writes only TODAY's workspace-local date.** Date cutoffs
  are per workspace (`workspace_settings.timezone`), so one UTC-midnight tick is wrong for
  every workspace that is not on UTC — which is what it used to do. The value that survives a
  day is the last tick before that workspace's midnight; when the local date rolls over the
  day stops being addressed and is marked `finalized`. A missed day stays a GAP: the report
  renders it unavailable, and `buildFallbackSnapshots`-style interpolation is prohibited.
- **`work_items.accepted_date` is maintained by a TRIGGER** (`trg_sync_accepted_date`,
  migration 0086), not by the service: `db/seeds/**` and raw SQL write this table directly,
  and an Accepted row with no acceptance timestamp is a data-quality error the reports refuse
  to guess about. The trigger never invents a date for a row that was already accepted before
  0086 — those stay NULL and Velocity reports them as `unclassified`.
- **`iterations.timebox_group_id` is how All Teams fuses per-Team iterations.** It is DERIVED
  from (project, start, end) — `timeboxGroupIdFor()` and migration 0087 share the expression,
  pinned by a spec — and computed ONCE at create, so a later date edit cannot split a
  historical bar. The approved mockup shows the failure this prevents: two adjacent velocity
  bars both labelled 25.1.
- **`workspace_settings.working_days`** (ISO 1–7, default Mon–Fri) is the Burndown x-axis and
  the Ideal line's index. The Ideal line is indexed by WORKING day and reaches zero on the
  last one; the mockup interpolates over calendar days and never reaches zero — the SRS wins.
- **`release_daily_snapshots.team_id IS NULL` is the All Teams row, and it is MEASURED, not
  summed** from the Team rows: a work item two Teams both touch must be counted once. Points
  and count live on the same row because `Chart Unit` is a display switch over one population.
- Report series colours are `--report-*` tokens (both themes) in `globals.css`, exposed via
  `BRAND.report*`. They are data colours fixed by the BA, deliberately not `primary`.

## Observability

The implementation lives in `@qnsc-vn/observability` — shared with opshub, so fix it
there, not here. `libs/platform` keeps only re-export façades (`observability/index.ts`,
`context/request-context.ts`) so existing `@platform` import sites stay valid.

- **One AsyncLocalStorage.** `request-context.ts` re-exports the package's store. A
  second local instance would mean HTTP requests seed one store while the pino mixin
  reads another, and every request log line would silently lose `workspaceId`,
  `userId` and `correlationId`. `request-context.spec.ts` pins it.
- **Don't log `correlationId`/`workspaceId`/`userId` by hand.** The pino mixin adds
  them to every line from ALS, plus `trace.id`/`span.id`. Background work must call
  `withJobContext(name, fn)` or it has no context at all.
- **`@Span` is deliberate, not universal.** Auto-instrumentation already spans every
  HTTP request, DB query, cache call and AWS SDK call. Add `@Span` for internal
  fan-out, hot paths, or long-running domain operations — not for CRUD passthroughs,
  where it just duplicates the pg span underneath. 5 of 23 services have spans and
  that is fine.
- **Never put an id in a metric label.** The recorder signatures make it a type
  error; `normalizeRoute()` is the safety net when a route template isn't available.
  IDs go on spans and logs.
- **Metrics are emitted, not declared.** If you add a name to `METRIC_NAMES` in the
  package, something must record it — a spec asserts instruments == names. This repo
  previously declared 23 names and implemented none.
- **`OTEL_ENABLED` is `false` everywhere** and no collector exists yet, so spans and
  metrics are no-ops today. Logs are the live signal. See
  `docs/superpowers/specs/2026-07-26-observability-architecture-design.md`.

## Infrastructure invariants

- **`infra/live/{develop,prod}/main.tf` hold values, never resources.** The whole
  stack is `infra/modules/stack`, so the two environments cannot drift
  structurally — only in what they feed in. Adding a resource means editing the
  module once. Relocating an existing address needs a `moved{}` block in
  `infra/live/*/moved.tf`, or Terraform destroys and recreates it.
- **Security posture is not a per-environment knob.** The cache module always
  enables KMS at rest and TLS in transit, which is why `REDIS_URL` is always
  `rediss://`. ioredis turns TLS on from that scheme alone — no client option is
  needed, and `redis://` against these nodes simply fails to connect. Develop
  cannot be configured weaker than production here; sizing is the only difference.
- **Sessions live only in the cache.** That is why it sits outside the ECS tasks:
  it survives task replacement, so a deploy does not log everyone out. Replacing
  the cache node *does* log everyone out — treat that as a user-visible change.
- **An infra change alone does not take effect — it needs a deploy.** Terraform
  owns the task definition's environment and the Pages project's `API_ORIGIN`, but
  `ecs-service` sets `ignore_changes = [task_definition]` and Pages env changes
  only apply to the next deployment. Terraform registers the new revision; the
  deploy pipeline is what moves the service onto it. So `infra/**` is deliberately
  **not** in either deploy workflow's `paths-ignore`, and both have a
  `wait-for-infra` gate to sequence deploy-after-apply on the same sha. Re-adding
  `infra/**` there recreates a silent failure: the apply succeeds, the new
  definition is correct, nothing rolls, and the old value stays live. That is
  exactly how develop ran against a deleted cache endpoint (`valkey: down` on
  `/v1/readyz`) after the cache migration.
- **Don't roll the service from `infra-apply` instead.** Terraform's newest task
  definition carries a new *image*, so rolling onto it there would ship app code
  ahead of `Run database migrations`.
- **ElastiCache cluster ids and replication-group ids share one namespace.**
  `CreateReplicationGroup` fails with `InvalidParameterValue: Cannot have a
  cluster and replication group with same identifier` while a same-named cluster
  is still deleting. Terraform runs an unrelated destroy and create in parallel,
  so a same-name migration between the two resource types needs two applies — the
  plan cannot show you this.

## Environment flags that look wrong and are not

Two settings in `infra/live/*` read like mistakes. Both are deliberate; changing
either opens a hole or leaks API surface.

- **`NODE_ENV=production` in DEVELOP.** Not a copy-paste error. `devLoginAllowed`
  in `@qnsc-vn/identity` is `nodeEnv !== 'production'`, so flipping develop to
  `development` would expose the **passwordless** `/v1/bff/dev-login` on a public
  host — anyone knowing a seeded address (`dev@qnsc.dev` is in this repo) could sign
  in as that user with no password. Develop deliberately requires real Entra SSO.
  If a local passwordless login is wanted, run the app locally where `.env` sets
  `NODE_ENV=test`; do not change the deployed value.
  (`LOG_PRETTY` is pinned `"false"` in infra, so JSON logs do not depend on this.)

- **`SWAGGER_ENABLED` unset (= off) in BOTH environments.** `/api/docs` publishes the
  full endpoint inventory and every schema, unauthenticated, and both API hosts are
  public. Explore the API locally instead — `.env` sets `SWAGGER_ENABLED=true`, so
  `localhost:3000/api/docs` works while developing. It used to be derived from
  `NODE_ENV !== 'production'`, which meant any non-prod-labelled environment
  published it without anyone choosing to; that is why it is now explicit opt-in.

## Auth model (read before touching a guard)

- **Browser sessions are BFF, not bearer.** The SPA holds no tokens. It talks to a
  same-origin Cloudflare Pages Function (`apps/web/functions/v1/[[path]].ts`) that
  proxies to the API, and authentication rides an opaque `__Host-rally_session`
  cookie backed by a server-side Valkey session. Bearer still works for machine
  clients — `JwtAuthGuard` handles both paths.
- **One guard, one decorator.** `PolicyGuard`
  (`libs/modules/access/src/interface/http/policy.guard.ts`) is the single
  authorization decision point. Controllers carry `@AuthPolicy()`; routes carry
  `@RequirePermission(...)` from `@modules/access`. The signature is tier-safe by
  overload: a workspace-tier code takes NO scope, a project-tier code REQUIRES one
  (`{ from: 'param'|'query'|'body', field }`, or `{ resource, from, field }` to
  resolve the project by loading the row). Passing the wrong shape is a compile
  error, deliberately. `@Auth()` is authentication ONLY — it grants every
  authenticated caller, so use it only where the surface is self-scoped
  (`me/*`, `notifications/*`) or runs around a session existing (`auth/*`).
  The old `@platform` `RequirePermission` + the `PermissionGuard` from
  `@qnsc-vn/identity` are gone; so is `@RequireProjectPermission`.
- **A route with no `@RequirePermission` is OPEN, not denied.** `PolicyGuard`
  returns `true` when it finds no metadata, and `@AuthPolicy()` sets none. That is
  why `test/route-policy.ratchet.spec.ts` counts undecorated handlers and only
  ever lets the number fall.
- **Permissions are NEVER in the token.** The access token carries identity only.
  `PolicyGuard` resolves them from the database on every check, through one cached
  read per (workspace, user) (`authz:assign:<ws>:<user>`, 5-min TTL) that serves
  both tiers. Write paths call `AccessService.invalidateUser(s)` after commit, so a
  grant or revocation lands on the user's NEXT request — on every replica. Do not
  reintroduce `claims.permissions`: that snapshot is what forced the old
  authorization-epoch counter, and the epoch is gone with it.
- **A principal's `permissions` array is inert.** Nothing reads it. An e2e fixture
  cannot grant itself anything by declaring a list — it needs a real assignment
  (see `ensureViewerGrant` in `test/e2e/support/flow-harness.ts`).
- **Project scope is additive.** A project-scoped role can only add permissions; it
  cannot subtract a workspace-wide grant. Known limitation, tracked in
  `RALLY_HARDENING_PLAN.md` (R3).
- **CSRF is enforced by a hook, not per route.** `requiresCsrfProtection`
  (`libs/platform/src/http/csrf.ts`) is the one place the policy lives. A raw
  `fetch` write in the SPA must send `X-CSRF-Token` via `withCsrfHeader`.
- **Two paths fail open** when Valkey is down: the token denylist and the rate
  limiter. Each emits BOTH a `securityFailOpen` log field (matched by a CloudWatch
  metric filter + alarm) and a `security.fail_open` counter. The `FailOpenControl`
  union in the package is the one source for both, and `fail-open.spec.ts` greps
  `infra/live/*` to prove the field the package emits is the field the Terraform
  filters on. (The union still declares `authz_epoch` / `authz_epoch_bump` from the
  deleted epoch service — nothing emits them now; drop them on the package's next
  major.)
- **The permission cache degrades, it does not fail open.** A read or write error
  falls back to the database, so authorization stays correct and only latency
  suffers. It logs a warning and is deliberately NOT tagged `securityFailOpen` —
  that field means "a security control was skipped", which is not what happens here.

## Sibling repo

`opshub` (`../opshub`) is a second product on the same architecture, and the
boilerplate is meant to stay identical: workflows, `infra/`, `libs/platform`,
`libs/shared-kernel`, `apps/*/bootstrap`, `apps/web/src/{shared,app}`. A fix to any
of those here should be ported there in the same week, and vice versa.

**A difference between the two repos is either declared in `docs/DIVERGENCE.md` or it
is drift.** Read that before "aligning" anything — several differences are deliberate
(opshub is single-tenant with `self|team|dept|region` scopes and dotted permission
codes; rally is workspace-scoped with `ns:*` wildcards).

rally is ahead on infra, CI gates, BFF auth and test depth; opshub is ahead on
authorization scope dimensions, delegation and IdP role mapping. Both now resolve
permissions from the database — see
`docs/superpowers/specs/2026-07-28-auth-convergence.md` for the shared model and the
ordered list of what opshub still has to do. Wider audit:
`OPSHUB_RALLY_PARITY_PLAN.md` and `RALLY_HARDENING_PLAN.md` one directory up.

What may live in a *shared package* is a separate rule, recorded in
`qnsc-app-platform/docs/ADMISSION-TEST.md`: divergence that would be a security
defect or a cross-repo contract break belongs there; divergence that would merely be
inconsistent stays in the product.

## Conventions

- Conventional commits, scope required for `feat` and `security` (`feat(auth): …`).
  release-please owns versions and the changelog — never bump by hand.
- Errors: throw the domain exceptions from `@platform` (`NotFoundException`,
  `ConflictException`, `PermissionDeniedException`, …) with a stable code the
  frontend can branch on; the global filter maps them to HTTP.
- New env vars go in `libs/platform/src/config/env.schema.ts` (validated at boot,
  fail fast) **and** `.env.example` **and** CI **and** `infra/live/*`. Booleans use
  the `booleanish` helper — `z.coerce.boolean()` turns `"false"` into `true`.
