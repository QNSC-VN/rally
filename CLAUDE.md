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

## Auth model (read before touching a guard)

- **Browser sessions are BFF, not bearer.** The SPA holds no tokens. It talks to a
  same-origin Cloudflare Pages Function (`apps/web/functions/v1/[[path]].ts`) that
  proxies to the API, and authentication rides an opaque `__Host-rally_session`
  cookie backed by a server-side Valkey session. Bearer still works for machine
  clients — `JwtAuthGuard` handles both paths.
- **`@RequirePermission` only accepts workspace-tier codes.** Project-tier
  permissions must be resolved per project: use `@RequireProjectPermission` (id on
  the request) or `AccessService.assertProjectPermission` (id known after a load).
  Passing the wrong tier is a compile error, deliberately.
- **Project scope is additive.** A project-scoped role can only add permissions; it
  cannot subtract a workspace-wide grant. Known limitation, tracked in
  `RALLY_HARDENING_PLAN.md` (R3).
- **CSRF is enforced by a hook, not per route.** `requiresCsrfProtection`
  (`libs/platform/src/http/csrf.ts`) is the one place the policy lives. A raw
  `fetch` write in the SPA must send `X-CSRF-Token` via `withCsrfHeader`.
- **Four paths fail open** when Valkey is down: the token denylist, the rate limiter,
  and the authorization-epoch lookup and bump. Each emits BOTH a `securityFailOpen`
  log field (matched by a CloudWatch metric filter + alarm) and a
  `security.fail_open` counter. The `FailOpenControl` union in the package is the one
  source for both, and `fail-open.spec.ts` greps `infra/live/*` to prove the field the
  package emits is the field the Terraform filters on.

## Sibling repo

`opshub` (`../opshub`) is a second product on the same architecture, and the
boilerplate is meant to stay identical: workflows, `infra/`, `libs/platform`,
`libs/shared-kernel`, `apps/*/bootstrap`, `apps/web/src/{shared,app}`. A fix to any
of those here should be ported there in the same week, and vice versa. OpsHub is
ahead on scoped authorization (DB-resolved, cached, `self|team|dept|region`); rally
is ahead on infra, CI gates, BFF auth, and test depth. See
`OPSHUB_RALLY_PARITY_PLAN.md` and `RALLY_HARDENING_PLAN.md` one directory up.

## Conventions

- Conventional commits, scope required for `feat` and `security` (`feat(auth): …`).
  release-please owns versions and the changelog — never bump by hand.
- Errors: throw the domain exceptions from `@platform` (`NotFoundException`,
  `ConflictException`, `PermissionDeniedException`, …) with a stable code the
  frontend can branch on; the global filter maps them to HTTP.
- New env vars go in `libs/platform/src/config/env.schema.ts` (validated at boot,
  fail fast) **and** `.env.example` **and** CI **and** `infra/live/*`. Booleans use
  the `booleanish` helper — `z.coerce.boolean()` turns `"false"` into `true`.
