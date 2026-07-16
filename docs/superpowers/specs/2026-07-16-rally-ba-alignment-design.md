# Rally ↔ BA Business Alignment — Design Spec

Date: 2026-07-16
Source of truth: `product-docs/projects/mini-rally` (BA docs + SRS Phase 0–3 + mockup).
Scope: business-flow / feature-coverage alignment. Architecture/code-structure choices (tenancy, tasks-table split, PBAC internals) are explicitly out of scope.

## Approved decisions

| Item | Decision |
|---|---|
| Enum drift | **Full DB alignment** — migrate severity + schedule_state values to BA vocabulary. |
| F1 iteration accept | **Gate + auto-accept + separate rollover** action. |
| F6 linking | **Full BA relation set** (blocks/duplicates/relates_to/depends_on/causes) + inverse + cycle guard. |
| F7 notifications | **In-app** on assign / state-change / comment / mention. |
| Cross-cutting | Audit for hardcode / magic numbers; centralize into constants / enums / drizzle enums. |

## Cross-cutting principle

One source of truth per concept, reused by all callers:
- `TaskRollup` shared method (F3) — single parent-completion rule.
- `WorkItemNotifier` facade (F7) — single recipient-resolution + preference-filter + enqueue path.
- `workItemRelations` constants + inverse map (F6) — single relation vocabulary.
- All new enums declared in `db/schema/enums.ts` (drizzle) with derived TS union types; no string literals for enum-like values in services/DTOs/FE.

## 1. Enum alignment

**defect_severity** — value renames (rows preserved): `high→major`, `medium→minor`, `low→trivial`. Result `critical, major, minor, trivial, none`. Drop the label-remap layer in FE `entities/work-item/model/types.ts` (tokens == labels now).

**work_item_schedule_state** — target `idea, defined, in_progress, completed, accepted, release`:
- `released → release` (rename value).
- Remove `ready`: backfill `='ready' → 'defined'`, then enum type-swap (create new type, `ALTER COLUMN … USING`, drop old, rename). Handle column default + generated `search_vector` + indexes.
- Pre-check: grep for any code branch on `'ready'` / `'released'`.

Migrations: `0040_defect_severity_align.sql`, `0041_schedule_state_align.sql`. Update `enums.ts`, FE types, DTO validators, seeds, tests. Register in `_journal.json`.

## 2. F2 — block defect delete
`WorkItemsService.deleteWorkItem`: `type==='defect'` → `PreconditionFailedException('DEFECT_DELETE_FORBIDDEN', …)`. FE hides/disables delete for defects.

## 3. F3 — team-status rollup gate (DRY)
Extract all-tasks-complete→parent-`completed` rule into one method (work-items service, current correct impl). `TeamStatusService` stops force-completing; calls the shared method. Parent→completed only when every child task `completed`; never auto-revert.

## 4. F1 — iteration accept
- `acceptIteration`: assert `itemCount≥1` AND all assigned Story/Defect `scheduleState==='accepted'` else `409 ITERATION_EMPTY` / `ITERATION_NOT_ALL_ACCEPTED`. No carry-over inside accept.
- Auto-accept: on a work item flipping to `accepted`, if its iteration is `committed` and all items now accepted → auto-transition iteration→accepted (idempotent).
- New `rolloverUnfinished(iterationId, targetIterationId?)` + `POST /iterations/:id/rollover` (old move-out logic).

## 5. F5 — comments UI
FE hooks + `comment-thread.tsx` (mirrors `attachment-block.tsx`): threaded, add/edit/delete own, read-only without `work_item:edit`, on Work Item Detail → Details tab. @mention picker from project members. Migration adds `comments.mentioned_user_ids uuid[]`; feeds F7.

## 6. F6 — work-item relations
- New enum `work_item_relation_type` (drizzle). New table `work_item_relations(id, workspace_id, source_item_id, target_item_id, relation_type, created_by, created_at)`, unique(source,target,type).
- Inverse map (single const): blocks↔blocked_by, depends_on↔required_by, causes↔caused_by, duplicates↔duplicate_of, relates_to↔relates_to.
- Cycle guard (BFS) for blocks/depends_on; reject self-link + dup. Workspace-scoped, cross-project allowed.
- Repo + service `{listRelations,linkWorkItem,unlinkWorkItem}`; endpoints `GET/POST /work-items/:id/relations`, `DELETE /work-items/:id/relations/:relationId` (`work_item:edit`). Activity-log on link/unlink.
- FE "Linked Items" panel on Detail.

## 7. F7 — notification events
- Templates: `WORK_ITEM_ASSIGNED, WORK_ITEM_STATE_CHANGED, WORK_ITEM_COMMENTED, WORK_ITEM_MENTIONED`.
- `WorkItemNotifier` facade: recipients = watchers ∪ assignee ∪ mentioned − actor − preference-opted-out → `NotificationSchedulerService.schedule(…)` with dedup idempotencyKey.
- Producers: `WorkItemsService` (assign, state-change), `CollaborationService.createComment` (comment + mention). Auto-watch assignee + commenter.

## Testing / rollout
Vitest units per rule (accept gate/auto-accept, rollover, defect-delete, rollup gate, relation inverse+cycle, notifier recipients). Migrations on scratch DB + `pnpm typecheck` + web build. Enum type-swap is the single irreversible step (documented).

## Constants / magic-number policy
While touching each area: replace inline literals (pagination sizes, zero-pad widths, retry counts, TTLs, default states, prefixes) with named constants co-located with their domain (`*.constants.ts`) or enums. New literals introduced must be named.
