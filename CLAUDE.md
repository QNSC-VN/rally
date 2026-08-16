# Rally — working notes

Conventions that already exist in this repo but are easy to miss, plus the
non-obvious tooling behaviour. Read this before changing build, auth, or DB code.

## Where the real documentation lives

| Topic                                                 | File                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Frontend conventions (FSD layers, shared/ui, i18n)    | `apps/web/FRONTEND_CONVENTIONS.md`                      |
| Entity surface pattern (list + detail scaffolds)      | `apps/web/ADR-001-entity-surface-pattern.md`            |
| Component migration state + ratchets                  | `apps/web/FRONTEND_COMPONENT_AUDIT.md`                  |
| Design specs and wave plans                           | `docs/superpowers/{specs,plans}/`                       |
| Auth model shared with opshub (+ what opshub must do) | `docs/superpowers/specs/2026-07-28-auth-convergence.md` |
| Declared differences from opshub                      | `docs/DIVERGENCE.md`                                    |
| SCM (GitHub App) setup                                | `docs/scm-github-app.md`                                |

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

  **Applying a HIGHER-numbered migration first strands the lower one on that database, silently.**
  Drizzle records the journal's `when` as `created_at` and applies only entries past the newest
  recorded value, so if `0120` is applied while `0119` is still being written, `pnpm db:migrate`
  afterwards reports "Migrations applied" and `0119` never runs — its table simply does not exist.
  Fresh databases and CI are fine, because the journal's array order is still ascending; this bites the
  local database you are testing on, which is the one you would trust. Two ways in: writing two
  migrations in parallel (do not — one at a time, even across parallel work), or a `when` that is not
  strictly greater than its predecessor's. Verify with
  `select count(*) from drizzle.__drizzle_migrations` against the journal's entry count; recover by
  applying the stranded file by hand or recreating the database. (Two historical pairs — 0005/0006 and
  0018/0019 — have non-ascending `when` values and ARE applied, so a non-monotonic journal is not by
  itself proof of a skip; count the rows.)
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
  **Re-measure when you raise them.** The floors sat ~11 points under real coverage for two phases
  (70/66/62/70 against 82/77/81/83), so a ten-point regression would have passed — a ratchet that
  trails that far measures nothing. Same for `fe-consistency.ratchet.test.ts`: four of its six
  baselines had drifted below their true counts, so 39 new violations could have landed green. Measure
  by forcing the baselines to `-1` and reading the counts the failures report — a grep alongside gets
  it wrong (mine said 8 for `text-[` where the real count is 2).
- **`ProjectScopeResolver`'s `work_item` kind spans TWO tables.** Tasks left `work_items` for
  `work.tasks` at the Phase 3 split (migration 0072), but the ROUTES did not split with them —
  `PATCH /work-items/:id`, `/:id/activity`, `/:id/attachments`, `/:id/watchers` and
  `PATCH /team-status/tasks/:taskId` all take a TASK's own id. The resolver mapped the kind to
  `work_items` alone, so the guard threw `WORK_ITEM_NOT_FOUND` for every task id before the handler
  ran, as a Workspace Admin, regardless of permission. A Task was uneditable everywhere, its Revision
  History permanently empty and its attachments unreachable — four Phase 1 contracts dead on one line
  of table mapping. It now falls back to `work.tasks` on a miss, mirroring
  `WorkItemDrizzleRepository.findById`, whose own docblock already described that fallback as what
  task surfaces depend on. **Adding a `task` resource kind would NOT have worked**: the routes are
  shared, so one kind has to cover both tables.
- **A spec that calls a service directly cannot see a guard defect.** Every task spec called
  `WorkItemsService` and the whole suite passed over the fault above for as long as it existed. Same
  blind spot that hid the `report:view` bug. `test/e2e/task-routes.e2e.spec.ts` and
  `report-authz.e2e.spec.ts` are the shape that catches it: real `AppModule`, `app.inject()`, a Bearer
  token from `AuthService.devLogin` (Bearer callers are CSRF-exempt by design, so no token dance).
- **A decorator-counting ratchet is not an authorization test.** `route-policy.ratchet.spec.ts` reads
  source text, so it cannot tell a correct `@RequirePermission` from a misspelled code or a
  project-tier code whose scope resolves from the wrong field. `test/e2e/report-authz.e2e.spec.ts` is
  the shape that does: real `AppModule`, `app.inject()`, both directions. Three things it had to learn
  the hard way — the test app has **no `/v1` prefix** and **no cookie plugin** (`reply.setCookie is
not a function`, so use `AuthService.devLogin` for a bearer token), the **ValidationPipe runs before
  the guard** (an incomplete query is a 400 and never reaches authorization), and a JIT-provisioned SSO
  user is **not** a denied principal — `assignDefaultRole` grants `project_member`, which the BA gives
  `report:view`. Use a seeded user with custom roles for the negative case.
- **The grids are DIVs, so `aria-sort` and `role="columnheader"` are deliberately absent.** They are
  only meaningful on a real `columnheader`, and `DataTableFrame` renders a scroll container while each
  page renders its own rows — adding the role to the header alone would announce a one-row table,
  which is worse than no table semantics. `SortHeader` carries the state in its accessible name
  instead ("Rank, sorted ascending. Activate to sort."), which is true regardless of the surrounding
  structure. It is also a real `<button>` now: it was a `div` with `onClick`, so sorting — a
  documented feature on every grid in the app — was pointer-only.
- **Rank reorder needs a KEYBOARD sensor AND a focusable grip — both, or neither works.**
  `KeyboardSensor` appeared nowhere in the SPA, and `DragHandle` was a `div`, so reorder was
  pointer-only on Backlog, Iteration Status, Quality and Portfolio. Adding the sensor alone would not
  have helped: dnd-kit activates from the ACTIVATOR's `onKeyDown`, and dnd-kit's `attributes` (which
  carry `role="button"` and `tabIndex`) were spread on the ROW while `listeners` were on the grip — so
  focus landed on one node and the key handler lived on another. `attributes` now go on the grip
  alongside `listeners` (which also stops every row announcing as a button with its own tab stop), and
  `useRerankSensors()` is the one shared sensor set. Backlog and Iteration Status previously hand-rolled
  `useSensors(useSensor(PointerSensor…))`, which is exactly why they diverged — there was no single
  place to add the keyboard sensor. Capacity Planning's grip already did this correctly and was the
  model.
- **`EMPTY_VALUE` (`'--'`) is the only placeholder for an absent value**, per its own docblock ("not an
  em-dash, because that is what real Rally renders"). 15 em-dash literals had drifted back in, two of
  them colliding *within one screen* — Portfolio detail rendered `'--'` in the sidebar beside `'—'` in
  both children tables. When replacing these, note that the string also appears in prose comments; a
  blind find-and-replace edits those too.
- **The frontend has ratchets too** (`apps/web/src/test/fe-consistency.ratchet.test.ts`):
  raw `<button>`, inline styles, hardcoded copy, file length, and CSRF headers on
  raw `fetch` writes. They may only decrease.
- **The SPA's API client is generated AND committed.** `apps/web/src/shared/api/generated/api.ts`
  comes from `/api/docs-json`, so any DTO change needs
  `pnpm --filter rally-web codegen` against a running local API, then a commit. The
  `OpenAPI contract` job regenerates from the spec it captured and diffs
  (`codegen:check`), so drift fails CI instead of failing at runtime.

  **`/api/docs-json` can serve a STALE document from a watch-mode restart.** Nest builds the Swagger
  document once at bootstrap, so `pnpm start:dev` recompiling is not the same thing as the served spec
  being current — it reported `Found 0 errors`, answered on the port, and still described the DTO as it
  was before the last edit. Codegen then wrote a client that was *correct for a spec nobody has*, and
  the only symptom was one absent field: `git diff` on the client was EMPTY, which reads exactly like
  "no DTO change was needed". **Grep the served spec for a marker before trusting a generated client**
  (`curl -s localhost:3000/api/docs-json | grep <newField>`), and restart the API rather than relying
  on the watcher. Worth also knowing the diff is legitimately huge when the module graph changes:
  `openapi-typescript` emits in spec order, which follows module init order, so adding one module
  import reordered ~1200 lines with no route added or removed. Compare route INVENTORIES, not the line
  count, to tell that apart from a real loss — and regenerate twice across a restart if you need to
  prove the order is deterministic, because a nondeterministic one would flake `codegen:check`.
- **`waitFor() timed out` in `notification-flow.e2e.spec.ts` is an ENVIRONMENT fault, not a flake.**
  Two independent causes, both seen in one session:
  1. **Email is unconfigured.** `.env` ships `EMAIL_PROVIDER=ses`, but `MAIL_FROM_EMAIL` is
     `.optional()` in `env.schema.ts` despite its own comment saying "Required when
     EMAIL_PROVIDER != 'dev'". Unset, `resolveFromEmail` returns `''`, every send fails with
     `Email address not verified "Mini Rally" <>`, and after three failures the email circuit
     breaker opens and stays open for the process — so the relay never delivers and the test waits
     out its 10s. Set `MAIL_FROM_EMAIL` and verify it in localstack:
     `docker exec -i rally-localstack awslocal ses verify-email-identity --email-address <addr>`.
     (The breaker is in-process, so restarting the API clears it; the failed rows are not retried
     and can be deleted.)
  2. **A live worker is a competing consumer** of `messaging.notification_outbox` and claims the
     rows the test is waiting for. Stop `pnpm start:dev:worker` before a BE e2e run.
     Neither is a product defect, and both look exactly like one. Check
     `docker ps` first: localstack dying mid-session produces the same symptom.
- **Run `pnpm lint`, not path-scoped `eslint`.** CI lints `{apps/api,apps/worker,libs,db}/**/*.ts` in one
  pass; linting only the paths you touched misses rules that fire elsewhere in that glob — and
  `no-unused-vars` exempts `^_` for ARGUMENTS only, not for destructured variables, so the
  `const { X: _unused, ...rest }` idiom is an error here. That combination put a lint failure on `main`.
- **`tsc -b` can pass on STALE build info.** Two things hid behind that in one session: an
  error code missing from the `ErrorCode` union, and a client that had never seen a new
  route (which surfaces only as `Cannot POST /v1/...` in the browser). When a change spans
  packages, verify with `tsc -b --force`.

## Fixtures: two projects, one reset, no leaks

**The seed produces EXACTLY two projects, and that is load-bearing.** `SEEDED.nxp` carries the depth —
three iterations (finished / active / future), two releases, an Epic with seven Features, a draft AND a
published capacity plan, frozen Burndown + burnup history, SCM links, attachments, notifications.
`SEEDED.pay` mirrors every entity TYPE with one row each, so anything needing a _second_ project
(isolation, permission scoping, cross-project refusals, "another release") has one waiting. Both are
exported from `test/e2e/support/flow-harness.ts`.

- **`pnpm db:seed:test` RESETS before seeding**, via `db/seeds/reset.ts`. The BE e2e suite does the same
  once per run (`test/e2e/support/global-setup.ts`, one shared table list). `E2E_SKIP_RESET=true` opts
  out when bisecting.
- **The reset is on the fixture ENTRYPOINT, never inside `seed()`.** `db/migrate.ts` calls `seed()` when
  `SEED_ON_DEPLOY` is set, and truncating a deployed database because a migration ran would be
  catastrophic.
- **Why a reset and not idempotent upserts.** The fixtures use fixed UUIDs with `onConflictDoNothing`,
  which survives a re-run but not a database other things wrote to. **Item keys are unique per
  WORKSPACE** (`uq_portfolio_item_key`, `uq_work_item_key`), not per project, and tests mint them from
  `workspace_item_counters` — so a leftover `US-3` makes the fixture's `US-3` conflict and vanish
  SILENTLY. That happened twice while this was written: once `EP-1`/`FE-1` took an entire project's
  portfolio with them, surfacing three steps later as a foreign-key error on an allocation.
- **A seeded key must also advance the counter**, or the app mints it again and collides on the next
  create.
- **Do NOT run the BE e2e suite while Playwright or a manual session is live.** The reset truncates
  under them. Eight Playwright specs failed at ~21s each exactly that way.
- **And run `pnpm db:seed:test` AFTER a BE e2e run, before Playwright.** The reset is at the START of
  the BE run, so the suite leaves all 303 tests' debris behind — hundreds of extra projects,
  iterations and teams. `golden-journey.e2e.ts` then failed on the Add Item step (the modal stays open
  because the server refused the create), and it reproduced on a clean checkout with the changes
  stashed, so it is the database and not the diff. `pnpm db:seed:test` cleared it. Stash-and-rerun is
  the cheap way to tell the two apart before hunting a phantom regression.
- **The e2e suite used to leak ~84 projects per run with no teardown anywhere** — 37 files, every
  `afterAll` closing the app and cleaning nothing. Twice that pushed `portfolio_items.rank`
  (`varchar(255)`, extended by appending) to exactly 255 characters at ~1,900 items, after which every
  insert failed with `value too long for type character varying(255)` and the suite could not run at
  all. `test/e2e-fixtures.ratchet.spec.ts` caps the `createProject` count so it can only fall.
- **Playwright is per-SURFACE journeys, not per-page smoke checks.** Six files holding one or two
  assertions each — and each paying a full login — were merged into the surface they belong to. A test
  named "header, tabs and shared Artifacts tab render" is a smoke check; the merged spec walks list → ID
  column → detail → tabs in one navigation.

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
  migration 0087), not by the service: `db/seeds/**` and raw SQL write this table directly,
  and an Accepted row with no acceptance timestamp is a data-quality error the reports refuse
  to guess about. The trigger never invents a date for a row that was already accepted before
  0087 — those stay NULL and Velocity reports them as `unclassified`. Verified by experiment:
  `accepted` sets it, `release` RETAINS it (accepted-equivalent), reopening clears it, and a
  later re-acceptance writes a fresh, later timestamp. Velocity SRS §3 gives DEV a backfill for the
  pre-0087 rows and `pnpm db:backfill:accepted-date` (`--dry-run` to report only) is it: the date comes
  from the LATEST `work_item.schedule_state_changed` activity row into an accepted state — latest, not
  earliest, because an item can be accepted, reopened and accepted again. It refuses to touch a row that
  already has a timestamp, and a row with no such history is REPORTED and left NULL rather than dated on
  no evidence.
- **The timebox says WHICH window; the WORK says whose it is.** `iterations.team_id` is optional
  here (real Rally collapses project and team, we do not), so a project may run one shared sprint
  every team works inside — 195 of 206 local iterations name no team. Filtering reports on
  `iterations.team_id` therefore returned NOTHING for a selected Team while Team Status showed the
  hours, and Velocity, which had no team predicate on the work at all, credited every point in a
  timebox to whatever team the timebox named. A team-scoped report now takes the team's own
  iterations **plus the shared ones** (`teamOrSharedTimebox`) and narrows the numbers per row by
  `coalesce(item.team_id, iteration.team_id)` — the same two-tier rule `getScopedTaskHours` and
  Team Status already used. An unknown `teamId` is a 404, never relabelled `All Teams`.
- **Nothing keeps `work_items.team_id` and its iteration's team in step by itself.**
  `assertIterationAssignable` refuses the pair with `ITERATION_TEAM_MISMATCH`, but the update path
  only checked it when the patch mentioned an iteration — so moving an item to another team left it
  parked in the old team's sprint, in two steps instead of one. A team change now revalidates the
  iteration the item already sits in. Seeds bypass the service entirely, which is how `US-D2` came
  to be Team Beta's story inside Team Alpha's Sprint 26.1.
- **`iterations.timebox_group_id` is how All Teams fuses per-Team iterations.** It is DERIVED
  from (project, start, end) — `timeboxGroupIdFor()`, migration 0088 and the trigger added in 0093
  share one expression, pinned by a spec — and computed ONCE, so a later date edit cannot split a
  historical bar. The approved mockup shows the failure this prevents: two adjacent velocity
  bars both labelled 25.1. It is maintained by a **trigger** because the service was demonstrably
  not the only writer: `create` set it, `update` omitted it, and `db/seeds/**` inserts dated
  iterations directly — 40 rows had dates and no group, three of them sharing a window with four
  that were grouped, so each became its own bar.
- **The Ideal BASELINE is per TEAM too, and All Teams is the SUM** (`iteration_team_baselines`,
  migration 0098). Two different rules for two different quantities, both stated by IB §4: the
  snapshot rows' `team_id IS NULL` is a MEASURED All Teams row that is never summed, while here
  `team_id IS NULL` means "work whose team cannot be resolved" and every row IS summed for All Teams.
  Migration 0093 gave the rows a team dimension and left the baseline as one column on `iterations`, so
  a team-scoped chart drew the WHOLE PROJECT's Ideal against one team's bars — and because §6 compares
  `remainingToDo(d)` with `ideal(d)`, the indicator read "On track" for a team that had burned nothing
  and could not read "Behind plan" until a team exceeded every other team's estimate as well. Capture
  groups by the same `coalesce(task, parent, iteration)` team the hours are measured with, so the
  baseline and its bars can never be scoped differently. The release Ideal target got the same
  treatment in migration 0099 (`release_team_targets`), which also DROPPED
  `releases.ideal_target_points` / `_count` — so a note here claiming that target "still has this
  defect" is stale, and it named two columns that no longer exist. Both quantities are now per-team.
- **The snapshot job only writes INSIDE the timebox window.** `findActiveIterations` selects on
  `state = 'committed'` and nothing else, and committing early is legal — so an iteration committed
  before it started had its *immutable* baseline captured at commit time, commonly zero because tasks
  are broken down after commitment. A captured `0` is the trap: it is not null, so it passes every "no
  baseline" check, `idealLine(0, N)` returns zeros, the `noBaseline` note stays hidden, and a flat zero
  line is drawn as a measured plan. The release loop always had this guard; the iteration loop now does
  too.
- **Eligibility must be counted in the SAME scope as the measurement.** Velocity's eligibility join
  carried no team predicate while `getVelocityItems` narrowed by `coalesce(item, iteration)`, so a
  shared timebox became an eligible bar for a team whose work was then filtered out of it — a
  zero-point bar for a sprint the team never worked in, dividing Trend, Last 3, Best 3 and Worst 3.
  `countScheduledWork` had the mirror image: counted project-wide, a team with nothing in a shared
  sprint was told its snapshot history was missing. Both now take the scope.
- **A LIVE fact must not outrank FROZEN history.** `hasScheduledWork` is a live count and the series is
  frozen, so a rolled-over iteration reported `historyState: 'complete'` with a full recorded series
  and the screen replaced it with "no scheduled work". §5 makes only MISSING SNAPSHOTS unavailable, so
  the live emptiness is consulted last. Same mistake as the missing-baseline one, in a different place.
- **Burndown history carries a TEAM** (`iteration_daily_snapshots.team_id`, migration 0093).
  `team_id IS NULL` is the All Teams row and every scope is MEASURED independently — the All Teams
  row is never the sum of the team rows, or a task two teams both touch counts twice. Frozen
  history cannot be re-sliced on read, so without the column a team-scoped Burndown simply could
  not be served; a read picks exactly one series (team rows, or the All Teams row), never both.
  Team rows begin at 0093, so a team-scoped chart of older history is an honest gap.
- **In Release Tracking, a team-agnostic row counts inside EVERY scope** — `inScope` admits
  `teamId === null` under a selected Team, not just under All Teams. This is NOT the
  `coalesce(item, iteration)` two-tier rule used elsewhere: a release owns no timebox, so there is no
  second tier to fall back to, and the strict `team_id = ?` it replaced dropped the ordinary case
  (`portfolio_items.team_id` and `work_items.team_id` are both nullable and mostly unset). The
  per-Team totals therefore do not sum to All Teams, which is already this report's contract.
  **The predicate is shared by the live report and by `ReportSnapshotService` on purpose** — one rule
  for a measurement and for its own eligibility, the property whose absence caused the zero-point
  Velocity bars. The cost of that sharing is that changing the rule changes what the FROZEN writer
  records, and two things follow, both of which a future rule change must handle again:
  `release_team_targets` is captured once per (release, team) with `onConflictDoNothing`, so already
  captured targets keep the OLD population and the Ideal line sits permanently below its own bars —
  migration 0116 deletes the team rows (never the All Teams row, whose population did not move) so the
  next tick re-takes them under the same rule that measures the bars. And `release_daily_snapshots`
  team rows written before 0116 measured the narrower population: an honest series break, recorded
  here exactly like "team rows begin at 0093" above, never interpolated away.
- **`GET /releases/:id/burndown` is gone** (with the Release detail progress panel and seven DTO
  fields). It answered "how far along is this release?" from the same `release_daily_snapshots` rows as
  Release Tracking but under a different definition — All Teams only, no scope control, no Ideal — so
  two surfaces gave one release two numbers. FR-037 puts release progress in
  `Portfolio > Release Tracking`; Phase 3 Release list/detail must not add a progress column or widget.
  Do not re-add a progress reader here.
- **The Phase 6 snapshot tables now have foreign keys.** `iteration_daily_snapshots` and
  `member_capacity` had NONE (verified against `pg_constraint`). Orphan snapshots happened to be
  unreachable through the API — deleting an iteration is blocked unless it is still `planning`, and
  only `committed` iterations are snapshotted — but orphaned `member_capacity` rows were reachable,
  and Team Capacity inner-joins `teams`/`users`, so an orphan row DROPS out and the Capacity total
  quietly falls while Estimate/ToDo/Actual stay. "Unreachable today" is a coincidence of two
  unrelated rules, not an invariant.
- **`workspace_settings.working_days`** (ISO 1–7, default Mon–Fri) is the Burndown x-axis and
  the Ideal line's index. The Ideal line is indexed by WORKING day and reaches zero on the
  last one; the mockup interpolates over calendar days and never reaches zero — the SRS wins.
- **`release_daily_snapshots.team_id IS NULL` is the All Teams row, and it is MEASURED, not
  summed** from the Team rows: a work item two Teams both touch must be counted once. Points
  and count live on the same row because `Chart Unit` is a display switch over one population.
- **An absent number renders `EMPTY_VALUE` (`--`), never `0`.** `data` is `undefined` both while a
  request is in flight and after it fails, so `?? 0` turns a network fault into a measured claim:
  Release Tracking showed three large zeros ("this release has no Features") and Team Capacity four
  `0h` cards ("this team planned nothing") — the latter directly ABOVE its own error message, because
  the error branch sat on the table and the KPI strip is above it. `ReportSurface` now takes an `error`
  slot so the strip and the body go absent together; a report that passes it must also render its
  `strip` in the absent state, since the strip is the caller's node. Velocity never read `isError` at
  all and rendered §6's own sentence "no completed iteration with scheduled work exists" for a 500.
  The KPI row stays MOUNTED through all of this — the BA's structure-preserving rule — which is exactly
  why the values cannot be coerced.
- Report series colours are `--report-*` tokens (both themes) in `globals.css`, exposed via
  `BRAND.report*`. They are data colours fixed by the BA, deliberately not `primary`.
- **A chart must pass `dataTable` to `ChartFrame`, and the SVG is `aria-hidden`.** A recharts plot is
  paths plus loose `<text>` nodes, so assistive tech reads a pile of numbers in painting order with
  nothing to say which series or which day any belongs to — and these reports ARE their values. The
  frame renders the caller's own row array as a visually hidden `<table>` instead (`sr-only`, never
  `display:none`), which is why the two cannot disagree. `null` renders as the caller's `noDataLabel`;
  a gap stays a gap here too.
- **`ChartFrame.underAxis` is for a SECOND axis row, not a footer.** The burnup's iteration band is
  part of the x-axis (RT §7, RT-AC-09: "X-axis shows dates and a secondary iteration-name row"). From
  `footer` it rendered below the legend strip and up to two history notes — ~90px from the dates it
  labels — where it reads as a third summary block.
- **`teamName === null` is `All Teams`, and it is the DEFAULT scope.** All four surfaces printed
  `teamName ?? ''`, so the scope a reader sees FIRST rendered as "NextGen Platform - " and "Team: ".
  Use `teamScopeLabel` / `reportScopeLabel` (`features/reporting/scope.ts`); the term is `All Teams`
  per every Phase 6 §6/§7, even though `capacity.json` and `settings.json` spell it "All teams".
- **A team-scoped iteration PICKER must offer the team's own timeboxes plus the shared ones**
  (`iterationsInScope`) — the client half of `teamOrSharedTimebox`. Do not pass `teamId` to
  `useIterations` for this: that filter is a strict `team_id = ?` and drops exactly the shared
  iterations the report measures, because SQL equality never matches NULL. `listAssignmentOptions`
  already had the OR-NULL form; the list endpoint does not.
- **`historyState` describes SNAPSHOTS only.** Both burndown and burnup once folded "no Ideal
  baseline" into that enum, which made a missing baseline discard measured bars that had really
  been recorded — IB §3 scopes the baseline to the Ideal LINE, and §5 makes only missing
  snapshots unavailable. The baseline is now reported separately
  (`totalTaskEstimateAtStart` / `idealTarget`, null when absent) and a fourth state `no-window`
  covers an iteration or release with no dates. That state exists because the alternative was a
  500: the service had nothing but `''` to pass, `'' < ''` slipped past the inverted-range guard
  in `workingDaysBetween`, and `addDays('')` threw `RangeError`.
- **`releases.ideal_target_points` / `_count` are captured ONCE, by the snapshot job**, on a
  release's first snapshot day, from the then-current planned scope — the same `IS NULL`-guarded
  capture as the iteration baseline, and for the same reason (RT-BR-09): an Ideal derived from
  today's Planned value silently redraws every past day whenever scope changes. Before this
  nothing wrote those columns at all, so the Ideal line could never be drawn for any release.
- **A sparse series needs DOTS, not just lines.** `connectNulls={false}` is right — a bridged gap
  is a fabrication — but a line segment needs two adjacent points, so a measured day between two
  gaps drew zero pixels and a young release rendered an empty grid beside populated totals. Give
  a dot an explicit `fill`: recharts fills dots white by default and draws the series colour as
  the ring, so `{ r: 2, strokeWidth: 0 }` alone is twelve invisible dots on a white card.
- **The demo seed writes frozen report history** (`seedReportHistory` in `db/seeds/demo.ts`).
  Both seeded timeboxes are in the past and the cron only ever writes TODAY, so without it every
  Phase 6 chart shows its empty state on a fresh database. The rows deliberately include a GAP,
  weekend audit rows and a sparse burnup — production must never fabricate history, a dev seed
  must, and those shapes are the ones worth being able to see.

## Team Status and Team Capacity are ONE population

The Team Capacity SRS says it twice — the scoped Task set comes from "the Task's PARENT Story/Defect
Project, Team and Iteration assignment", and Capacity "must use the same source/table/API domain as
`Track > Team Status`". Three things had them disagreeing, all now pinned by
`test/e2e/team-status-agreement.e2e.spec.ts`:

- **The team predicate is three-tier on BOTH sides**: `coalesce(task.team_id, parent.team_id,
iteration.team_id)`. Team Status used a strict `tasks.team_id = ?`, and a task's team only DEFAULTS
  to its parent's (SRS P1-04) — so a Story that carries the team while its task does not is an ordinary
  shape, and SQL equality never matches NULL. Those tasks vanished from Team Status while Team Capacity
  counted them. The reporting file's comment already claimed parity; it was true of the
  iteration-membership half and false of the team half.
- **A soft delete does not cascade to `work.tasks`** (the FK is `ON DELETE cascade`, which a soft
  delete never fires). Team Status LEFT-joined the parent, so orphaned tasks were still counted with a
  blank Work Product column, while Iteration Status and the Phase 6 projection inner-join and exclude
  them. Both surfaces now inner-join.
- **`member_capacity` is unique on `(project_id, team_id, iteration_id, user_id)`**, so a member on two
  teams has two legitimate rows in one iteration. `getCapacities` filtered on iteration + user only and
  collapsed into a `Map<userId, hours>` — last row won, non-deterministically, and `upsertCapacity`
  re-resolves its team from the iteration, so an edit could overwrite a different team's number than
  the one displayed. It now takes the team key and SUMs per member (under All Teams, where the screen
  groups by MEMBER, the total of their per-team allocations is the honest answer).

**Editing Estimate on Team Status must send `estimateHours` ALONE.** It used to also set `todoHours`
whenever the caller had not, which defined the field before `WorkItemsService` saw it and so bypassed
the once-only gate (`input.todoHours === undefined && item.todoHours === null`) — the copy then
happened on every estimate edit, re-inflating a completed task's auto-zeroed To Do and moving the
Iteration Status total, the Tasks-tab total and the next Burndown snapshot with it. The rule lives in
the service; the other two edit surfaces already did this correctly, and this screen's own UI comment
described the behaviour it did not have.

## Task hours are THREE independent fields

`Estimate`, `To Do` and `Actual` never derive from each other (Portfolio SRS:141-147), with exactly
two automatic moves:

- **The FIRST Estimate copies itself to To Do, once** — and only while To Do is `null`. `0` is not
  "unset": a completed task has exactly that, so re-copying would undo the auto-zero below or
  overwrite a planner who typed 0 deliberately. The create path always did this; the update path did
  not, so estimating an existing task left To Do empty and the number had to be typed twice.
- **Completing a task sets To Do to 0**, and **reopening does NOT restore it** — the owner enters a new
  remaining value if there is one. This replaces the older `Estimate = To Do + Actual` display rule.

## A Task's Iteration is DERIVED, not cascaded

The BA says it three times — "A Task inherits Project, Team, Iteration and Release/Milestone context
THROUGH ITS PARENT Story/Defect" (`BUSINESS_BASELINE.md`), "no independent Iteration selector"
(`P1-TASK-011`), "without an independent Task iteration assignment" (`P2-IS-024`) — and real Rally
shows the field read-only. That is stronger than keeping two values in step: **a Task owns no
iteration value at all.**

- **`work.tasks.iteration_id` is a maintained mirror** (`trg_task_iteration_from_parent`, migration
  0095). It is re-read from `parent_id` on every insert and on any update touching `parent_id` or
  `iteration_id`, so reparenting follows the new parent for free and a raw-SQL write cannot diverge.
  Enforced in the DB because `db/seeds/**` writes `work.tasks` directly — the same reason
  `trg_sync_accepted_date` and `timebox_group_id` are triggers.
- **Moving a parent moves its Tasks** (`trg_cascade_iteration_to_tasks`, `AFTER UPDATE OF
iteration_id`). Before this, `createTask` inherited once at birth and nothing looked at the parent
  again, so a moved Story left its Tasks counting hours in the old sprint.
- **Passing an iteration for a Task is a REFUSAL** (`TASK_ITERATION_DERIVED`), not a silent
  discard — and on `createTask` it is a compile error, because the opts type no longer has the field.
  `CreateTaskSchema` dropped it too, so the contract does not advertise what the service refuses. The
  guard sits in `createWorkItem` as well: `POST /work-items` with `type: 'task'` skips the
  `createTask` wrapper entirely.
- **`teamId` is NOT derived.** A Task's team only DEFAULTS to its parent's and stays settable (SRS
  P1-04); `getScopedTaskHours` resolves `coalesce(task, parent, iteration)` deliberately. Only the
  Iteration is contractually derived.

## An archived Team keeps its hours

"Archive Team does not delete the linked Work Item/Sprint history" (DB design §488), so Team Capacity
still reports an archived team's rows — a total that shrinks when a team is disbanded is worse than
one that explains itself. The row carries `archived: true` and renders `TEAM_STATUS_STYLE.archived`,
because the global Team picker hides archived teams and nothing else on screen would say the team no
longer exists. The flag is ORed across the capacity rows and the task rows: both reach the same
bucket, and a task row whose `teams` join missed must not clear what a capacity row set correctly.

**That sentence used to credit the wrong filter, and the difference was a live defect.** It said the
picker hides them "because `app-shell.tsx` filters `status === 'active'`" — but the status on those
rows is `project_teams.status`, the LINK's status, projected over the joined `teams` row. So the
client filter only ever dropped UNLINKED links, and an archived-but-still-linked team was offered
everywhere that feed reaches: every team picker, and the Capacity plan's Add Team dialog, whose write
path requires both statuses and answers `CAPACITY_TEAM_NOT_FOUND`. That is the "another eligible Team
cannot be added" half of P5-CP-006 — a picker offering what the server refuses. The predicate now
lives in `ProjectTeamDrizzleRepository` (`eq(teams.status, 'active')`, and an inner join, since a NULL
team can no longer satisfy it), so the claim is true server-side and both callers get the narrower
set. Narrowing the shared query rather than adding a parameter is deliberate: `projectTeamContext`'s
own docblock requires the server to count exactly the population the picker offers. **Read a
`status` column twice before trusting it — a join can project a link's status where a row's status
is what the sentence means.**

## A rule stated as an INVARIANT cannot be implemented as one write's hook

Two BA rules were specified as conditions and built as hooks on one particular write, so a different
write reaching the same state left the rule unsatisfied. Both are now pinned by
`test/e2e/derived-invariants.e2e.spec.ts`.

- **Iteration auto-accept is a condition over MEMBERSHIP**: "a non-empty Iteration auto-changes to
  `Accepted` when all ASSIGNED Story/Defect items are `Accepted`" (BUSINESS_BASELINE:12, BR-IT-02) —
  and *assigned* is what a scope change alters. The check only ran on a `scheduleState` transition, so
  moving the last open Story OUT, or bulk-assigning an accepted Story IN, left the iteration Committed
  while the Iteration Status tile read ACCEPTED 100%. Every membership write now re-evaluates BOTH
  affected iterations (the one left and the one joined). Safe to run on every move because
  `autoAcceptIterationIfComplete` only ever goes `planning|committed → accepted` — the same rule's
  "does not auto-reverse" clause is what makes that true.
- **A Milestone's target window EQUALS its linked Releases' MIN/MAX** (P3-MS-FR-011/012, §73).
  `recalcTargetDates` ran on create, update, link writes — and on `getMilestone`, a repair on the READ
  path. It never ran when a linked Release's own dates were edited, and `listMilestones` reads the
  persisted columns, so the detail page self-healed while the list showed a stale window. **The
  self-healing is why it hid**: the surface a reviewer opens was the one that repaired itself.
  Migration 0097 moves this to triggers covering all three invalidating writes (a release date edit, a
  link add/remove, a manual write to a linked milestone, which §73 makes read-only), and the read-path
  repair is gone. `§75` is respected: removing the last link leaves the dates alone rather than
  inferring NULL.

**The smell to watch for: a value repaired on read.** It makes the defect invisible on exactly the
screen someone checks, and it leaves every other reader stale.

**Its sibling: a value HIDDEN on read.** Migration 0118 deletes the Workspace Admin's
`project_members` rows (§2.1/AC-8), and `db/seeds/demo.ts` wrote the same row straight back — and
`pnpm db:migrate` runs that seed, so every local and CI database undid the migration on the spot. What
made it invisible is that the fix's own three readers (the roster query, `memberCount`, and the POST
refusal) all correctly hide such a row, so nothing on screen would ever have shown it coming back. It
was not cosmetic either: `AccessService.effectiveAssignments` synthesizes a project grant FROM that
table, so the row is dormant only while the user is a WA — demote them and it becomes a live Project
Admin grant no roster displays. **Whenever a migration DELETES rows, grep `db/seeds/**` for the writer
before assuming the deletion holds.**

**And a third: state FROZEN before its source arrived.** The user-access modal's draft materialised
`teamIds` from its baseline the moment any part of a row was edited, but team memberships come from
their own query — so choosing `Editor` before `/v1/teams/{id}/members` resolved froze `[]` in, and a
draft SHADOWS the baseline, so the real memberships could never reach it. §2.2's "an Editor needs a
Team" guard then stayed true forever: `Review Changes` disabled permanently, the user's own team
unchecked, no way out but closing the modal. **A draft must hold only what the user TOUCHED** —
`undefined` meaning "resolve against the baseline when it arrives", the same absent-versus-empty
distinction a capacity plan's window and an allocation's value already rely on. Diagnosis note, because
it presented as a flaky test (2 runs in 8): raising the `waitFor` timeout to 5s did NOT help, and that
is what proves frozen state rather than a slow render. Pin such a case with a DEFERRED promise so the
ordering is deterministic instead of lucky.

## Archive ordering cuts both ways

An Epic with active child Features cannot be archived — and a Feature whose Epic is archived cannot be
RESTORED (`PORTFOLIO_PARENT_ARCHIVED`). The second half was missing, so the forbidden state was
reachable in three legal steps: archive the Feature, archive the now-childless Epic, restore the
Feature. That leaves an active Feature under a hidden parent, which is what `assertReferences` refuses
on every other write. The message names the Epic's key, because an archived parent is invisible in
every list.

## Declared divergences from the BA, in Capacity Planning

Both were ruled on. Neither is drift, and neither should be "fixed" on sight.

- **Rollup and Complete keep Rally's Project+Release child filter.** The BA's Features-tab formula is
  `SUM(child.planEstimate WHERE child belongs to Feature)` with no qualifier (§314), and the nested
  per-team one adds only Team (§267). The code filters children by the plan's Project AND Release, which
  is Rally's documented rule: "If a portfolio item includes allocated points/counts, the Project and
  Release fields in the story must match the plan for that story to be included in the Rollup
  calculation." Without it a long-lived Feature inflates every plan that touches it — the plan charges
  work belonging to another release — so the filter stays and the BA formula is the divergence.
- **Nested `Dependencies` renders `0`, not `—`.** The BA's catalog suggests a dash (§205); Rally's column
  is a COUNT, dependencies are genuinely unimplemented rather than unknown, and `0` is true where a dash
  would read as "not known". Note this is the one place the app's own absent-value rule (`--` everywhere
  else) is deliberately not applied.
- **The cutline keeps the overflowing Feature BELOW the line.** Rally's Items-tab doc is the deciding
  sentence: "Items above the cutline fit within the defined plan capacity. Items below the line exceed
  the capacity of the plan." SRS §189 says the line is drawn "after the first Feature where cumulative
  planning Estimated reaches or exceeds Plan total Capacity", which puts that Feature above the line. The
  two differ by exactly one row — capacity 100 against 90, 20, 5 puts the 20 below here and above under
  §189.

  Worth knowing that this one was shipped §189's way and reverted: the BA reading went in under a
  blanket "align to the BA" instruction, and Broadcom's wording was only checked afterwards. `Rollup`,
  `Complete` and the cutline are now all decided the same way — the product's documented behaviour wins
  where the SRS restates it differently. If a future ruling reverses that, reverse all three together;
  half-and-half is how a plan starts disagreeing with itself.

  Verified at
  `techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/capacity-planning-page/view-capacity-plan-details/capacity-plan-items-tab.html`
  (the same page carries the Project/Release sentence above, for Complete and for estimated points).
  The cutline was removed from Rally and later restored, which is why it may be absent from an older
  screenshot or a different edition.

## An allocation's value is a FIXED SNAPSHOT with a source label

`capacity_plan_allocations.value` is NOT NULL and carries `source` (`feature_estimate` | `manual`),
which is migration 0101 reversing 0077 on purpose. Anything that reads or writes an allocation must
respect this:

- **Never resolve an allocation's charge on read.** SRS §11 is `fixed allocation.value set during
  planning/replanning`, and §337 defines Team Estimated as `SUM(allocation.value)`. 0077 had made the
  column nullable so a blank Estimate could resolve to the Feature's own estimate per request. That
  meant editing a Feature's Refined Estimate silently moved every Draft plan that had assigned it — a
  planner's committed demand changed with no action on the plan — and no surface could compute a total
  from the stored rows, so five of them re-resolved and agreed by luck.
- **`source` is why the value can be fixed.** 0077's stated objection was real: "a defaulted 8 and a
  deliberate 8 were indistinguishable." The BA answers it with a label, not a null (§185: blank
  "copies the Feature's top-down estimate into a fixed allocation row and labels its source `Feature
  Estimate`"; §186: a supplied one "becomes a fixed `Manual` allocation row").
- **The copy happens at WRITE time, in the plan's unit** — `defaultAllocationEstimate`, Refined →
  Preliminary, deliberately skipping Total Allocated so a blank field cannot commit the sum of the
  allocations it is creating (§294). `value: null` on a PATCH means RE-COPY, not clear: the emptied
  cell re-baselines the row against the Feature's forecast as it stands now.
- **A tier is a property of a FEATURE, not of an allocation row.** AC-014 resolves Feature Estimated
  from Total Allocated (team-assigned rows only) → Refined → Preliminary, once, over the aggregate.
  Allocation rows have a `source`; only item rows have a `tier`.
- **A merged parked row keeps its source only when exactly ONE row folded in.** A sum of two rows is a
  number no single rule produced, so it is `manual` — calling it a Feature estimate would misreport
  the Feature's size.

## Capacity: what refuses, and why

Three references into a capacity plan are now REFUSALS rather than silent repairs, all following
`RELEASE_HAS_CAPACITY_PLAN` on release delete — the pattern this repo already chose:

- **Moving a Feature to another project** while it is allocated
  (`PORTFOLIO_ITEM_HAS_CAPACITY_ALLOCATION`). A plan belongs to one project, so the Feature took
  nothing with it: the rows stayed behind, kept feeding that team's Estimated, the plan total and
  the cutline, and publish wrote the OLD project's Release onto it — the state `assertReferences`
  itself rejects. Deleting the rows instead would destroy committed numbers on a plan the person
  moving the Feature may not even be able to see. `applyPlanToFeature` also filters on the plan's
  project now, so the write is incapable of crossing projects even for rows that predate the guard.
- **Unlinking a team from a project** while it sits on one of that project's plans
  (`PROJECT_TEAM_HAS_CAPACITY_PLAN`). `project_teams` is a soft status flip, so
  `fk_capacity_plan_teams_team ON DELETE RESTRICT` never fires. `Remove Team` on the plan is the
  deliberate action and it re-parks the demand (AC-005), so the refusal costs nothing.
- **`assertTeamInProject` requires both the LINK and the TEAM to be active.** It checked neither, so
  an unlinked or archived team could still be added to a plan — recreating exactly what migration
  0085 was written to clean up.

**`capacity:view_draft` is the fourth capacity code, and it is now REDUNDANT — the requirement it
existed for is gone.** It was added because AC-012 was read as keeping a read-only Project Admin
"opening Draft and Published plans", which `capacity:manage || capacity:publish` could not express.
That reading is STALE: on `product-docs` `origin/main`, `P5-CAP-AC-012` says Capacity Planning "uses the
fixed Phase 4 Project Access baseline and has **no temporary editable Full/View permission row**",
`P5-CAP-AC-010` says "Editor/No Access do not access Capacity Planning", and `P5-CAP-AC-013` is marked
N/A with "Viewer level removed". So there is no read-only planner, and every role holding
`capacity:view_draft` (`workspace_admin`, `project_admin`) also holds `capacity:manage` — the code
cannot distinguish anyone. It is still granted and still read, deliberately: retiring a permission that
sits in live role arrays needs a migration, not a catalogue edit, and the BA has been asked to confirm
no future read-only planner is intended. Backfilled by migration 0094.

**The lesson worth more than the fact:** this note asserted an AC that the BA had since changed, and two
e2e tests were built on it — constructing a read-only planner from a CUSTOM ROLE, pinning a shape the
SRS had deleted. Read `product-docs` `origin/main` rather than a summary of it before building on an AC;
the local checkout is a gap-audit branch and lags where the BA authors.

## An invitation binds to an ADDRESS, and grants a real role

Two independent faults on the one flow that onboards every user, both fixed together:

- **Acceptance is bound to the invited email.** It used to validate only `pending` + not-expired, so
  the token was a bearer capability — a forwarded link, a shared inbox or a copied URL made the wrong
  person a member at the invited role (`INVITATION_EMAIL_MISMATCH` now refuses it, case-insensitively,
  because an IdP may return a differently-cased local part for the same mailbox).
- **`workspace_members.role_id` is authoritative for NOTHING.** `AccessService` resolves permissions
  from `user_role_assignments`, and this module's own members query reads the role from there too.
  `addMember` writes only the denormalised column, so the invited role was written where nobody reads
  it: a user invited as Project Admin landed with whatever `ensureDefaultRole` gives a first SSO
  login, and the admin who sent the invitation saw the intended role nowhere. Accept now calls
  `grantWorkspaceRole` **inside the same transaction** and invalidates the permission cache after
  commit, like `assignRole` does. Any new path that "assigns a role" must write the assignment table.

**Who SENDS the invitation email depends on `ENTRA_GUEST_INVITE_ENABLED`, and that is the ordering an
external collaborator depends on.** `inviteMember` wrote both outbox rows in one transaction and two
independent relays drained them — the email relay every 5s AND woken instantly by `wakeEmailRelay`, the
Entra guest relay on a 30s cron with no wake signal at all. So the link arrived in under a second and
the invitee's guest object in our tenant up to 30s later, plus Microsoft's directory replication: an
invitee who clicks immediately cannot authenticate (`NO_CONNECTION` from our login box, `AADSTS50020`
from Microsoft's), intermittently, and it reads as the feature being broken. With the flag ON the email
is now scheduled by the ONE component that knows the guest is ready — `EntraGuestInviteRelayService`,
in the same transaction that marks the row `sent` and writes `entra_guest_object_id`. Flag OFF is
untouched: nothing is enqueued, `GuestInviteSchedulerService.schedule` answers `false`, and the email
goes out inline. Four consequences worth knowing before touching either half:

- **A permanent Graph refusal schedules NO email** (invalid address, `User.Invite.All` unconsented, B2B
  invitations disabled tenant-wide). The invitee cannot authenticate, so a link is a dead end that also
  burns the one-shot token; the dead-letter log and `last_error` are the signal. **The operator action is
  CANCEL AND RE-INVITE, not `Resend Invitation`** — resend reuses the same `idempotencyKey`
  (`invitation.id`) with `onConflictDoNothing`, so a row already at `status = 'failed'` is untouched and
  the guest is never re-provisioned; only a NEW invitation mints a new key. A benign `proxyAddresses`
  collision DOES email — that invitee is already a directory member.
- **The flag gates ENQUEUEING, not draining.** The relay used to skip polling entirely while the flag
  was off; now that a queued row also owes the email, that would strand the invitee in silence, so
  committed intents are always drained.
- **`guest_invite_outbox.invite_token` holds the RAW token** (migration 0124), because only its sha256
  is persisted and the relay could not otherwise build `inviteUrl`. Scrubbed in the same write that
  schedules the email, and on a terminal failure. NULL also *means* "this row owes no email", which is
  what `resendInvitation` passes — it mails its own rotated token inline.
- **Both writers key the email on `invitation.id`**, so a flag flipped mid-flight cannot produce two
  invitation emails; the relay additionally refuses to mail a token whose hash no longer matches the
  invitation, or an invitation that is no longer `pending`.

## A cross-project LIST is scoped by `listReadableProjectIds`, not by `workspace_id`

`AccessService.listReadableProjectIds` is the authorization fact behind every cross-project list — its
own docblock says so, and Portfolio already used it. `GET /v1/projects` did not: no
`@RequirePermission`, and a query filtering on `workspace_id` + `deleted_at IS NULL` alone, so every
project's key, name, description, owner, dates and counts was readable by any authenticated principal
including one with zero role assignments. PRJ-FR-001 and §10 both say otherwise.

**`null` means UNRESTRICTED and an empty array means "nothing".** The sentinel exists precisely because
those two are different answers, so a caller that flattens `null` to `[]` fails closed and one that
flattens `[]` to "all" leaks the workspace. The repository short-circuits the empty case rather than
emitting `inArray(col, [])`, which is not portable as "match nothing".

`GET /projects/:id/members` was open for the same reason and is now `project:view` scoped to the path
id — **with no `resource` key**, because the param IS the project id and there is nothing to resolve
(`'project'` is deliberately not a `ScopedResource`).

**That note used to end "still open", and both halves are now CLOSED — recorded because the
resolution is the pattern, not the exception.** `GET :id/members-with-profile` was deferred behind
"gating it needs the feed split first", because it fed the Portfolio and Projects owner pickers as
well as User Management. The split shipped (`:id/member-options` for pickers, `:id/members-with-profile`
for the administrative roster) and the administrative half now carries `workspace:view`. And
`GET :id/members` — the third route, paged, with `roleId` and account `status` behind an in-service
claim that amounted to `assertActive` — is **DELETED**, not gated: it had no consumer anywhere, and a
gated dead route keeps a payload alive for whoever finds it next while reading, in review, as a
considered decision about an audience. Its absence is asserted in `authz-cluster.e2e.spec.ts` for a
Workspace ADMIN, because a 404 for an Editor is also what a gate would produce and would prove
nothing.

**And the `permission` argument has to actually decide something.** It did not, for the membership half:
`listReadableProjectIds` unioned a raw `project_members` query in unconditionally, so every project the
caller held an active row on was readable **regardless of whether that row's access level granted the
permission being asked about**. It was written when membership was the only per-project fact and it
survived the move to `access_level`, by which point `effectiveAssignments` already synthesized the same
rows correctly filtered — so it was duplication for a permission the level grants, and a silent
over-grant for one it does not. What it opened: `portfolio:view`, which `editor` deliberately withholds,
so **every project Editor read every field of every Epic and Feature in their projects** — the one
surface `P5-PI-FR-017` and §3.2:85 hide from them. No other caller was affected, because the rest ask
for `project:view` or `work_item:view`, which is exactly why it stayed invisible. Membership now reaches
the result only through the permission-filtered synthesis; the generalisable rule is that **a boundary
taking a permission must not union in a source that ignores it**, and the failure reads as a boundary in
review. Two second-order effects, both deliberate: the synthesis filters on `isProjectAccessLevel` where
the deleted query used `isNotNull`, so an unrecognised level is no longer readable; and it rides the
5-minute assignment cache, so a membership row written by raw SQL is invisible to cross-project lists
until `invalidateUser` is called.

**Closing it needed the picker split in the same change**, and that is the pattern now, not a one-off:
the emptied list was also the only feed for the `Feature` field on a Story/Defect, so the fix is
`GET /portfolio-items/options` (id, key, name, project) gated on `work_item:view`. The BA is **SILENT**
on whether an Editor may set a Story's Feature, so this is a **declared reading** and has been put to
them: §5.2:124 makes that field the only way Feature membership is ever set, §3.2:79 gives an Editor the
Story, and the closest precedent is the BA's own one field over — `Phase 2/02_Iterations/SRS.md:393`,
"Timeboxes hidden; may update Work Item Iteration through approved Backlog/Iteration Status flows only"
— hidden surface, permitted field, therefore a feed. Release is decided the *other* way and says so in
words ("cannot assign Release", BL §8:294), which is why that one is refused in `WorkItemsService`
instead. **Where the BA wanted a field withheld from an Editor it wrote a sentence; it wrote none for
Feature.** If they rule it like Release, the reversal is this route plus one SPA field. The feed is
single-project per §5.3:133, which is what lets the GUARD check it (`{ from: 'query', field:
'projectId' }`) instead of a service-side narrowing — so the service deliberately makes **no**
authorization call, pinned by a spec. Note the API still *accepts* a cross-project Feature link
(`assertFeatureLinkable` permits it, because Rally's rollup matches `feature_id` alone) while the picker
no longer offers one: 0 such rows exist, and the BA's field scope wins over offering it.

## A route's permission code must be one the intended role can hold

`GET /work-items/by-key` carried `workspace:view` — admin-only, since `workspace:*` is
admin-reserved and neither Project Admin nor Project Member holds any `workspace:*` code. It is the
sole resolver behind `/item/$itemKey`, so **every notification click and ID cell 403'd for both
non-admin roles** while the service's own `assertProjectPermission(work_item:view)` would have allowed
them. It now carries no decorator, deliberately: item keys are workspace-unique so the owning project
is unknown until the row loads, which is the same resolve-then-check shape as
`PATCH /work-items/reorder`. Same class of bug: `POST /iterations/:id/work-items` required
`iteration:edit` while the Add New button was gated on `work_item:create`, so a Project Member saw the
button and got a 403 for an item they can create from the Backlog.

**The pattern to watch for:** a gate chosen for where the id lives rather than for what the action is.
It is invisible in testing because the dev principal is a Workspace Admin whose `workspace:*` masks
every one of them — exactly how the `report:view` bug survived to migration 0092.

## Declared divergences from the BA, in the access model

Three rulings made on 2026-08-14, after an eight-slice audit cross-checked the code against BA main
(`product-docs` `55e7dbb`) and against real Broadcom Rally. None is drift; none should be "fixed" on
sight. The audit and its sourced Rally research are in
`product-docs/projects/mini-rally/09_Gap_Audit/`.

- **There is NO `Viewer` level, and Rally disagrees.** The BA removed it (`product-docs` `55e7dbb`,
  2026-08-14). It was restored by architect ruling the same day and **removed again on the BA's
  instruction** — migrations 0113 then 0115. The model is Workspace Admin plus per-Project `admin` or
  `editor`, with **No Access implicit** when no active `project_members` row exists; `No Access` is
  never a stored value or a dropdown choice, only the absence of a row reached through `Remove`.

  Recorded because it will come up again, and because the next person to read Broadcom's docs will
  reach for it. Real Rally's `ProjectPermission.Role` is No Access / Viewer / Editor / Project Admin,
  and its Viewer is load-bearing five ways: the documented answer to "make this user read-only", the
  **provisioning default** for a new user, one of four Quick Filter Toggles on the admin permission
  grid, the demotion target in the team-membership state machine, and a full-licence consumer whose
  only purpose is access control. So with `admin`/`editor`/absent alone, a read-only stakeholder or
  auditor is either invisible or a full Editor — the two configurations Rally customers most often
  need to avoid. If that becomes a real problem it needs a **new ruling**, not a quiet re-add: the
  CHECK constraint, `ACCESS_LEVEL_PERMISSIONS`, the DTO enums, the SPA's `access-levels.ts` mirror and
  the generated client all have to move together, and the last attempt showed what happens when one of
  them lags — `AccessService` filtered its synthesized assignments on a hand-written
  `'admin' | 'editor'` pair in two places, so a granted row read as No Access. Use
  `isProjectAccessLevel`, never an inline comparison.

  Sourced evidence: `product-docs/projects/mini-rally/09_Gap_Audit/research/RALLY_PERMISSIONS_MODEL.md`.
- **Team-scoped Editor is DROPPED as an authorization scope** (ruling 2026-08-14, reversing the
  earlier "KEPT" ruling of the same day — recorded rather than deleted, because the next person to read
  the BA's §2.2 will reach for it again). The BA scopes an Editor's writes to their assigned Teams
  (§2.2, §3.2 "in assigned Teams"), and Rally has **no `Team` object and no team authorization scope**
  at all — `POST /user/<OID>/teammemberships/add` takes **project** refs, and "Team Member" is a
  presentational checkbox with auto-promotion to Editor. Our own research file said "do not build a
  team scope"; it was kept anyway because the BA models Teams as first-class.

  **What reversed it was our own schema, not Rally's docs.** A team scope can only restrict rows that
  CARRY a team, and `portfolio_items.team_id` and `work_items.team_id` are both nullable and mostly
  unset (195 of 206 local iterations name no team). `assertTeamScoped` therefore admitted every
  `teamId === null` row *by design* — so the boundary admitted the ordinary case, which makes it a
  filter with a security-sounding name rather than a control. It covered 3 of ~14 Editor-reachable
  writes and **no reads**: the worst available state, because it reads as a boundary in review and is
  not one. Finishing it honestly would have required making `team_id` MANDATORY on every
  Editor-writable row — a data-model change across portfolio, work items and iterations, plus
  team-scoped read models on every list, report and picker.

  So Teams stay exactly what they already are: **delivery-model data, and a display filter.** Team
  membership, `team_members`, Team Status, Team Capacity and every report's team scoping are untouched
  — and note `RBE-06` now grants `editor` from a team roster row, which IS Rally's model arrived at from
  the other direction. **Do not re-add a team authorization scope without a fresh ruling, and if one is
  ever wanted, mandatory `team_id` is its precondition, not an optimisation.**
- **A per-Project `Admin` has NO structural authority**, following the BA over Rally. §3.1 marks
  every structural row Hidden for Admin — create/edit/archive/restore/delete Project, create/edit/
  deactivate/restore Team, assign Project access and Team membership — and gives it Read-only on
  "View Project Details and Teams". Rally's Project Admin *does* configure its project and edit
  viewer/editor/team-member permissions, so this is deliberate. In code: `PATCH /projects/:id` and
  the two `:id/teams` link/unlink routes carry **`workspace:edit`** (workspace-tier, WA-only), not
  `project:edit`.

  **`project:edit` deliberately STAYS in the Admin set**, because it also gates label and
  workflow-status configuration — delivery configuration, which §3.1's own summary gives Admin
  ("`Admin` is powerful for delivery management") — and because `View Permission Model` is a §3.1
  Admin row gated on that code. So do not read "Admin must not hold `project:edit`" from the rule
  above; read "the structural routes must not be gated on it".

## Permissions reach a workspace ONCE

`db/permissions.catalog.ts` is the source of truth, but `db/seeds/bootstrap.ts` upserts the
per-workspace tier roles with `set: { name }` — deliberately, so re-seeding cannot clobber an
admin's edits to a role's permissions. The consequence is easy to miss: **a permission added to
the catalogue never reaches an existing workspace.** Phase 6 added `report:view` to
PROJECT_ADMIN and PROJECT_MEMBER and every pre-Phase-6 workspace kept its old array, so all five
report routes answered 403 to everyone except Workspace Admin — whose `workspace:*` grant is the
global anchor and hid the fault everywhere it was tested. Migration 0092 backfills it.

So: **a new permission needs a backfill migration**, not just a catalogue entry. Force it only
when the permission is genuinely new (nobody can have revoked what never existed); a permission
that already shipped must be merged, not forced, or the migration undoes someone's decision.

**Custom roles and the editable permission matrix are DELETED** (ruling 2026-08-14). AC-11 makes the
Permission Model read-only with no editable matrix, and three things agreed: the editing UI was already
dead code (`RoleEditorDialog` unreferenced, `role-capabilities.ts` with no live consumer), the catalogue
above is the single source of truth so a customisable matrix forks it, and — the deciding reason —
custom-role CRUD plus workspace-scoped tier-role assignment together re-create exactly the company-wide
over-grant migration 0111 removed. The READ-ONLY Permission Model tab stays; it is an AC-11 requirement,
not a leftover.

**The removal is deliberately sequenced, because deleting a role a user HOLDS revokes their access:**
(1) remove the editing routes and dead UI — a contract change with no data risk; (2) a **dry-run report**
of every custom role, everyone holding one, and every workspace-scoped tier assignment (the
`pnpm db:backfill:accepted-date` shape: report, never guess); (3) only then a migration that removes
them, converting any real assignment to its per-project equivalent. Step 3 is gated on reading step 2's
output against a real database — do not collapse the three into one change.

## Seeds: what a DEPLOYED database is allowed to contain

Three tiers, and only the first two ever reach a deployed environment:

| tier | file | contents | where |
|---|---|---|---|
| reference | `db/seeds/reference.ts` | `access.system_roles` from `db/permissions.catalog.ts` | every env, every deploy |
| bootstrap | `db/seeds/bootstrap.ts` | workspace + Entra SSO + `workspace_settings` + workspace-owned tier roles | every env, every deploy |
| fixtures | `db/seeds/demo.ts` (+ `second-project.ts`, `reference-extras.ts`) | NXP/PAY projects, work items, capacity plan, frozen report history | LOCAL and CI only |

`db/migrate.ts` gates the fixtures on `SEED_ON_DEPLOY` **and** refuses them outright under
`NODE_ENV=production`, which is what deployed migrator tasks run with and nothing else does. Develop
used to set `seed_on_deploy = true`, so a database people read as real carried a fixture project and a
capacity plan; a shared environment whose contents nobody can vouch for is worse than an empty one,
because every bug report starts by asking which rows were fixtures. Both environments are now `false`
and the `NODE_ENV` floor means flipping one back would not be enough to reach a deployed database.

`resetFixtureTables` (`db/seeds/reset.ts`) TRUNCATEs and is wired only into `pnpm db:seed:test` and the
Playwright global setup — never into `seed()` or a migration. Its `FIXTURE_TABLES` list covers delivery
data and touches nothing in `access.*`, `workspace.*` or `identity.*`, so roles, the workspace, SSO and
users survive a reset. It does not name `iteration_team_baselines` or `release_team_targets`; those are
removed by `CASCADE` through their `ON DELETE CASCADE` parents (migrations 0098/0099).

## New business data: migration, seed, or neither

Three categories, three different answers. Get the category right before writing either.

**Reference data** — see "Permissions reach a workspace ONCE" above. Catalogue entry PLUS a backfill
migration; the seed alone will not carry it to an existing workspace.

**A schema or grain change over existing rows** — backfill inside the same migration, always.
`0101_capacity_allocation_fixed_value.sql` is the model: it freezes TODAY's resolved value so no plan
total moves on deploy, and it re-implements the service's own fallbacks in SQL (a per-size `COALESCE`
over the default preliminary-estimate map, `LEFT JOIN` for a missing settings row) so a
partially-customised workspace cannot fall back wholesale. Never leave a column NULL or `''` and expect
a later read path to cope.

**Time-series history** — `iteration_daily_snapshots`, `iteration_team_baselines`,
`release_daily_snapshots`, `release_team_targets`. **Cannot be backfilled, ever.** They are measurements
of a past day, and that data never existed. `SnapshotCronService` writes them hourly at :05, only for
dates inside an iteration's or release's own window, and baseline capture is `onConflictDoNothing` so it
cannot be re-taken. A fresh environment's Burndown and Burnup therefore start empty and fill forward,
and Velocity needs a FINISHED iteration before it says anything. The reports state that explicitly
(`noBaseline`, `historyState`) rather than drawing a flat zero line — do not "fix" that by synthesising
history.

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
  the cache node _does_ log everyone out — treat that as a user-visible change.
- **A secret REF is not always an ARN.** With `secrets_use_bundle`, the secrets module's
  `secret_arns` output returns `"<bundle arn>:<key>::"` — the ECS `valueFrom` form. ECS
  understands it; the Secrets Manager API does not, and rejects the whole string with
  `ValidationException: Invalid name`. So a value passed as a `secrets` entry is fine
  either way, but one passed as a plain **env var for the app to dereference at runtime**
  (`IDENTITY_HOME_SECRET_REF`, `GITHUB_APP_PRIVATE_KEY_SECRET_REF`) must be parsed.
  `SecretsManagerSecretResolver` is the one place that happens — it splits the key off the
  7-field ARN and reads it out of the bundle's JSON, which is what lets `use_bundle` flip
  in either direction with no app change. **Never call `GetSecretValue` with a raw ref.**
  This broke SSO login on develop for a day: every `POST /v1/bff/login/sso` was a 500 while
  the deploy, the migrator and the seed all reported success, because the seed stores the
  ref in `sso_connections.client_secret_ref` and only the *login* path dereferences it.
  IAM lists have the same trap from the other side and need `secret_iam_arns` instead.
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
  definition carries a new _image_, so rolling onto it there would ship app code
  ahead of `Run database migrations`.
- **REMOVING infra the running code still uses needs the deploy FIRST.** The normal
  order is apply-then-deploy (`wait-for-infra` gates it), and for an addition that is
  right — the code arrives after the resource exists. For a REMOVAL it is backwards,
  and the window is not theoretical: deleting the SNS topic in #394 left the old
  worker publishing to an ARN that no longer existed, the resilience breaker for
  `sns.publishOutboxEvent` opened, and six `outbox_events` rows burned all five
  attempts to `status = 'failed'` in the seconds before the new worker rolled. `failed`
  is excluded from every relay's fetch, so those rows were stranded SILENTLY — the
  projection looked healthy precisely because nothing was left pending. Migration 0103
  is the cleanup; the rule is the fix. Expand/contract: ship the code that no longer
  needs the resource, let it roll, then remove the resource in a second change.
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

What may live in a _shared package_ is a separate rule, recorded in
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
