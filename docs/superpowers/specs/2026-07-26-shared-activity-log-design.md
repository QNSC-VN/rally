# Shared Activity-Log (Revision History) — design

**Status:** proposed · **Date:** 2026-07-26 · **Author:** Nghia-VanTrong

## Problem

"Revision History" exists for **work items** (US/DE/Task) and **iterations**, as **two
near-identical, copy-pasted stacks**. We now want the same history for **projects,
milestones, and releases**. Copying the pattern again would leave us with **5×
duplication** (5 tables, 5 repos, 5 DTOs, 5 FE hooks, 5 tabs).

### Current state (audit 2026-07-26)

| Layer | work-items | iterations | shared? |
|---|---|---|---|
| Table | `work.activity_logs` — polymorphic `entity_type`+`entity_id` + `work_item_id` anchor | `work.iteration_activity_logs` — dedicated `iteration_id` | ✗ two tables |
| `ActivityChange`, `changed()` helper | ✓ | ✓ **verbatim dup** | ✗ |
| Repo port + drizzle repo | ✓ (tx-aware) | ✓ (best-effort) | ✗ dup structure |
| Diff fn | `diffWorkItem` (25 fields) | `diffIteration` (8 fields) | ✗ |
| `GET /:id/activity` + query/response DTO | ✓ | ✓ | ✗ dup |
| FE hook + history tab | `useActivityLog` + `HistoryTab` | `useIterationActivityLog` + `IterationHistoryTab` | ✗ dup layout |
| `describeActivity()` humanizer | ✓ | ✓ | ✓ **the one shared piece** (`entities/work-item/model/activity.ts`) |

- **projects / milestones / releases**: no activity-log wiring at all.
- The `audit` module (`audit.audit_logs`) is a **separate concern** — async, outbox-driven,
  operator compliance trail with `{before,after}` object diffs and `sourceEventId` dedup.
  It is **not** user-facing revision history. Out of scope; leave as-is.

## Goal

One shared activity-log primitive. Adding Revision History to a new entity becomes:
1. add its value to the `activity_entity_type` enum,
2. define a field-diff **config** (fields + rich-text set + per-field action name),
3. call `activityLogger.log(...)` at its create/update/state-change sites,
4. add a 3-line `GET /:id/activity` route delegating to the shared service,
5. drop `<ActivityHistoryTab entityType=… entityId=… />` in its detail page.

No new table, repo, DTO, FE hook, or FE tab.

## Design

### 1. One table (generalize the existing polymorphic one)

Promote `work.activity_logs` to THE shared store (it is already polymorphic):

```
work.activity_logs
  id            uuid pk
  workspace_id  uuid  not null   (workspace isolation)
  project_id    uuid  null       (nullable — projects/workspace-level entries)
  entity_type   activity_entity_type  not null
  entity_id     uuid  not null    (the subject: work item / iteration / project / …)
  context_id    uuid  null        (anchor for grouping child logs under a parent's
                                    history — e.g. task/attachment logs surface on
                                    the parent work item; renamed from work_item_id)
  actor_id      uuid  not null
  action        text  not null    (e.g. work_item.updated, iteration.committed,
                                    project.archived, release.state_changed)
  changes       jsonb null        ([{ field, old, new }])
  metadata      jsonb null
  created_at    timestamptz not null default now()

indexes: (workspace_id), (entity_type, entity_id, created_at DESC)  ← primary read,
         (context_id) where context_id is not null, (project_id)
```

- **Enum** `activity_entity_type`: add `iteration`, `project`, `milestone`, `release`
  (keep `work_item`, `task`, `attachment`).
- **`context_id`**: `work_item_id` renamed. The list query is `entity_type = ? AND
  (entity_id = ? OR context_id = ?)` so a work item's history still includes its
  tasks/attachments. For entities with no children, `context_id` is null and the
  query degenerates to `entity_id = ?`.

### 2. Shared module — `libs/modules/activity`

```
libs/modules/activity/src/
  domain/
    activity-log.types.ts        ActivityChange, ActivityLog, CreateActivityInput,
                                 ActivityEntityType, ActivityDiffConfig
    ports/activity-log.repository.ts   append(tx?), appendMany(tx?), listFor(entityType, id, page)
    activity-diff.ts             diffFields(before, after, config): ActivityChange[]  (+ action)
  application/
    activity-logger.service.ts   log(actor, {entityType, entityId, contextId?, action,
                                 changes?, projectId?}, tx?)  · logDiff(actor, entity,
                                 before, after, config, tx?)  · listFor(entityType, id, page)
  infrastructure/persistence/
    activity-log.drizzle-repository.ts   (tx-aware; LEFT JOIN users for actorName)
  interface/http/dto/
    activity.dto.ts              ActivityQueryDto (page/pageSize), ActivityResponseDto
```

- **`diffFields(before, after, config)`** — generic, config-driven. Config per entity:
  ```ts
  interface ActivityDiffConfig {
    fields: string[]                     // fields to diff
    richText?: string[]                  // compared as stripped text (no <p> noise)
    action: (field: string) => string    // field → action name (e.g. scheduleState →
                                          //   'work_item.schedule_state_changed')
  }
  ```
  Replaces the two `diffX` fns + the duplicated `changed()`.
- **`ActivityLogger`** is the single injectable every module uses. Transaction-aware
  (`tx?` executor) so mutation + log commit atomically where wanted; best-effort
  (try/catch, never fail the mutation) where the current iteration path is.
- Each domain module imports `ActivityLogger`; no module keeps its own table/repo/diff.

### 3. HTTP — thin per-entity routes (keep REST shape)

Each detail controller keeps a 3-line method:
```ts
@Get(':id/activity')
getActivity(@Param('id') id, @Query() q: ActivityQueryDto) {
  return this.activity.listFor('project', id, q)   // entityType is the constant
}
```
Response DTO is the single shared `ActivityResponseDto`. (Alternative — one
`GET /v1/activity?entityType=&entityId=` — rejected: per-entity routes match the
existing pattern, keep permission scoping natural, and avoid a generic route that
every client has to special-case.)

### 4. Frontend — one hook + one tab

- `useActivityLog(entityType, entityId)` — one hook, maps `entityType` → the entity's
  `/:id/activity` endpoint. Replaces `useActivityLog` + `useIterationActivityLog`.
- `<ActivityHistoryTab entityType entityId />` in `entities/activity/ui/` — the shared
  4-column newest-first grid (Revision · Description · Created · User). Replaces
  `HistoryTab` + `IterationHistoryTab`. Reuses the existing `describeActivity()`
  (moved to `entities/activity/model/` and kept as the single humanizer).

### 5. Per-entity config (the only per-entity code)

```ts
// libs/modules/projects/.../project-activity.config.ts
export const PROJECT_ACTIVITY: ActivityDiffConfig = {
  fields: ['name', 'description', 'leadId', 'startDate', 'status'],
  richText: ['description'],
  action: (f) => (f === 'status' ? 'project.status_changed' : 'project.updated'),
}
```
Milestones (name, targetStartDate/EndDate manual, releases-linked → derived) and
releases (name, theme, dates, state) get their own small configs. Explicit
transitions (iteration commit/accept, release/milestone state) are logged as named
actions via `log(..., { action })` rather than a field diff.

## Migration / phasing

### P1 — build the primitive + consolidate the two existing (prove parity, no coverage loss)
1. New module `libs/modules/activity` (types, port, repo, `ActivityLogger`, `diffFields`).
2. Migration `00xx_unify_activity_logs.sql`:
   - extend `activity_entity_type` enum (+iteration/project/milestone/release),
   - rename `work.activity_logs.work_item_id` → `context_id` (nullable),
   - **backfill** `work.iteration_activity_logs` rows into `work.activity_logs`
     (`entity_type='iteration'`, `entity_id=iteration_id`, `context_id=null`),
   - drop `work.iteration_activity_logs`.
   (Hand-written per repo convention; CI proves it applies on top of `main`.)
3. Rewire **work-items**: replace its diff + repo + logging calls with
   `ActivityLogger.logDiff(..., WORK_ITEM_ACTIVITY)` / `.log(...)`; keep `work_item`,
   `task`, `attachment` entity types + `context_id` anchor behavior. Delete the
   module-local activity types/port/repo/diff.
4. Rewire **iterations** the same way (config `ITERATION_ACTIVITY`; commit/accept as
   named actions). Delete its activity table refs + local stack.
5. FE: introduce `useActivityLog(entityType,id)` + `<ActivityHistoryTab>`; point the
   work-item + iteration detail pages at them; delete the two old hooks/tabs.
6. Update `vitest.config.ts` coverage include list for the new service; port existing
   activity assertions; keep the `work-items` + `iterations` activity e2e green.

### P2 — add projects, milestones, releases
For each: enum already has the value → add the field-diff config, add `log()` calls at
create/update/(state) sites, add the `GET /:id/activity` route + register in the detail
tabs (Projects detail, and the Release/Milestone detail — which currently show
Details + Artifacts; add a Revision History tab per SoT once confirmed with BA), drop
`<ActivityHistoryTab>`.

> **SRS note:** the reconciled SoT currently scopes Revision History to Work Item +
> Task only (ACT-FR-001/002); Release/Milestone/Iteration history is a beyond-spec
> parity extension already shipped for iterations. Extending to project/milestone/
> release is a **product decision to confirm with BA** — this design makes it a
> config change once approved.

## Consistency / scale

Adding history to any future entity = 1 enum value + 1 config + a few `log()` calls +
1 route + drop the shared tab. No new infrastructure. One humanizer, one table, one
service, one FE component — nothing can drift between entities again.

## Risks & mitigations

- **Data migration of existing logs** — backfill is a straight INSERT…SELECT from the
  iteration table before dropping it; verify counts pre/post in the migration + an e2e
  that lists iteration activity after migrate. Idempotent guard on re-run.
- **work-items is the biggest module** — rewire behind unchanged public behavior;
  its existing unit + e2e activity assertions are the parity net (must stay green).
- **Transactional vs best-effort** — `ActivityLogger.log(tx?)` supports both; preserve
  each call site's current semantics (work-items in-tx, iteration best-effort).
- **OpenAPI contract** — response DTO shape is unchanged (id/actorName/action/changes/
  metadata/createdAt); the `entityType`/`entityId` fields already exist on the
  work-item DTO, become standard. Regenerate the FE client.
- **Coverage ratchet** — new `ActivityLogger` gets a unit spec + is added to the
  include list; removed module files drop out of it.

## Testing

- **Unit:** `diffFields` (field diff, rich-text stripping, action mapping) + each
  entity config; `ActivityLogger.log`/`logDiff` (tx + best-effort).
- **E2E:** one parametrized "entity X emits its create/update/state activity and lists
  it" spec across work_item / iteration / project / milestone / release.
- **FE:** `<ActivityHistoryTab>` renders newest-first + humanized text for each entity.

## Concrete API (derived from the current code)

The two stacks already agree on the primitives — the shared module just names them once.

```ts
// domain/activity-log.types.ts
type ActivityEntityType = 'work_item' | 'task' | 'attachment'
  | 'iteration' | 'project' | 'milestone' | 'release'
interface ActivityChange { field: string; old: unknown; new: unknown }   // (unchanged shape)
interface CreateActivityInput {
  id: string; workspaceId: string; projectId: string | null
  entityType: ActivityEntityType; entityId: string; contextId?: string | null
  actorId: string | null; action: string
  changes: ActivityChange | null; metadata?: Record<string, unknown>
}
interface ActivityLog extends /* row */ { actorName: string | null }        // list output (users LEFT JOIN)

// domain/activity-diff.ts  — replaces both diffWorkItem + diffIteration + the 2 copies of changed()
interface ActivityDiffConfig<T> {
  fields: (keyof T)[]
  richText?: (keyof T)[]                       // logged as field-name-only (body nulled) — SRS §7
  action?: (field: keyof T) => string          // default: `${entityType}.updated`
}
function changed(a: unknown, b: unknown): boolean            // the shared normaliser (null/String)
function diffFields<T>(before: T, input: Partial<T>, cfg: ActivityDiffConfig<T>):
  { action: string; change: ActivityChange }[]

// application/activity-logger.service.ts  — the single injectable every module uses
class ActivityLogger {
  // Batched insert (appendMany under the hood). `tx` → participates in the caller's UoW.
  log(inputs: CreateActivityInput[], opts?: { tx?: DbExecutor }): Promise<void>
  // Same, wrapped in try/catch — a history write must never fail the mutation.
  logSafe(inputs: CreateActivityInput[], opts?: { tx?: DbExecutor }): Promise<void>
  // Convenience: diff → entries → log, in one call.
  logDiff<T>(subject: {workspaceId; projectId; entityType; entityId; contextId?},
             before: T, input: Partial<T>, cfg: ActivityDiffConfig<T>,
             actorId, opts?): Promise<void>
  listFor(entityType, entityId, page): Promise<{ data: ActivityLog[]; total; page; pageSize }>
}
```

Per-entity variation is entirely inside the **config + the `action` fn**:
- work-items: `action(f)` returns `task.*` vs `work_item.*` (the module passes `entityType`
  = 'task'|'work_item'); `scheduleState → *.state_changed`, `flowState` only on work_item,
  `assigneeId → work_item.assigned`, `priority → *.priority_changed`, estimate/todo/actual
  mapped as today. `contextId` = `parentId ?? id` for tasks (keeps task history on the parent).
- iterations: default `iteration.updated` for the 8 fields; **commit/accept** are named actions
  logged via `log([...{action:'iteration.committed'}])`, not a field diff (as today).
- projects/milestones/releases: small configs (§5) + named actions for archive / state changes.

## Logging semantics — batched + transactional, NOT queued/parallel

Deliberate, and it's the "good logic" answer:

- **Batched, one INSERT.** A single update can change several fields → several change rows.
  `appendMany` writes them in **one** insert (already the case). No N+1, no per-field round trip.
  "Parallel" writes would only add ordering races + connections for no gain.
- **In the mutation's transaction** (default, work-items path). The history is then always
  consistent with the data — never a logged change without the change, never a lost entry on
  rollback. This is why activity is **not** outbox/async: async is for the *audit* trail, whose
  compliance durability justifies the machinery; activity is cheap, inline, and read straight
  back on the detail page.
- **`logSafe` (best-effort)** for non-critical side events (relation add/remove, attachment
  confirm/delete, and the iteration path today) — try/catch so a log hiccup never 500s the
  mutation. Same batched insert, just swallow-and-warn on failure.
- **No fan-out queue.** Cross-entity entries in one operation (task complete → parent
  auto-complete logs 2 entities) are just two `CreateActivityInput`s in the **same batched
  `log()` call inside the same tx** — atomic, ordered, one insert. Simpler and safer than any
  async fan-out.

So: `diffFields` (pure) → build `CreateActivityInput[]` → one batched `log(inputs, {tx})`.
That is the whole hot path; it adds one INSERT to a write the user already awaited.

## Decision log
- Approach: **shared primitive, full consolidation** (migrate the 2 existing + add 3
  new) — chosen over "shared for new only" and "copy 3×" for a single consistent
  long-term pattern. (2026-07-26)
