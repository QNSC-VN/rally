-- 0122 — index the Audit Log's action filter.
--
-- `P45-04` moved the Action dimension server-side, so `GET /audit-logs?action=…` is now a real predicate
-- instead of a page-local filter. Nothing indexed it.
--
-- WHY THIS ONE AND NOT THE OTHERS
-- `ix_audit_workspace` is `(workspace_id, occurred_at)`, which is what serves the ordinary newest-first
-- page. An action-filtered page walks THAT index backwards discarding non-matching rows until it has
-- `limit` of them, so the cost scales with how rare the action is — worst case the whole workspace's
-- history for something like `project.deleted`. The COUNT that produces "1–50 of 1284" pays the same
-- walk, so the two together double it. `audit_logs` is append-only and is the largest table in the
-- schema, which is exactly where a sequential-ish scan stops being theoretical.
--
-- `ix_audit_actor` is `(workspace_id, actor_id)` with NO `occurred_at`, and that asymmetry is
-- deliberate rather than an oversight to copy: one actor's rows are a bounded set, so sorting them is
-- cheap and the actor filter shipped without an index of its own. An action is not bounded — every row
-- has one, and a handful of codes account for most of the table.
--
-- `occurred_at DESC` matches the query's own `ORDER BY occurred_at DESC, id ASC`, so the index serves
-- the filter and the ordering in one pass. `id` is deliberately not in the index: it is the tiebreaker
-- that makes the order total, not a filter, and Postgres can settle it from the heap for the handful of
-- rows sharing a timestamp.
--
-- No backfill and no data change: this is an index over rows that already exist.

CREATE INDEX IF NOT EXISTS "ix_audit_workspace_action"
  ON "audit"."audit_logs" ("workspace_id", "action", "occurred_at" DESC);
