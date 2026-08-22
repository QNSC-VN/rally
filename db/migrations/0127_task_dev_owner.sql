-- `Dev Owner` on a Task: a second, independent responsibility.
--
-- `work_items.dev_owner_id` has existed since Phase 3.4 for a Story/Defect. A TASK had no such
-- column, so `listTasksByParent` projected `null` for the id and the Tasks tab could render the
-- column but never fill it. BA `c42df59` (2026-08-22) makes the field first-class and names Tasks
-- explicitly: `P4-NOTIF-DC-012` fires an assignment notification when a user "is newly assigned as
-- `Owner` or `Dev Owner` of a US/DE/Task", and the Iteration Status / Backlog contracts describe
-- `devOwner` as a "dedicated nullable user reference … must not reuse `assignee_id`; schema
-- migration required".
--
-- Nullable and unconstrained, deliberately, exactly like `assignee_id` on the same table:
--
--   * NO foreign key to `identity.users`, matching `tasks.assignee_id` beside it. The eligibility
--     rule is enforced in the service (`ProjectsService.assertAssignable`) because it depends on the
--     project AND the team, which no FK can express; adding one here would also make a user delete
--     cascade into delivery history that should outlive the account.
--   * NO default. An unset Dev Owner is `No Entry`, which is a real answer and not a placeholder —
--     the same rule `EMPTY_VALUE` states for every absent value in the app.
--
-- No backfill: there is nothing to derive one from. Copying `assignee_id` across would be the exact
-- mistake the BA's own wording forbids ("must not reuse or overwrite `assignee_id`"), and would
-- silently give every existing task a Dev Owner nobody chose.
ALTER TABLE "work"."tasks" ADD COLUMN IF NOT EXISTS "dev_owner_id" uuid;

-- The Tasks tab, Team Status and the Phase 6 task projections all filter by owner; a Dev Owner
-- filter reads this column the same way. Partial, because the overwhelming majority of rows are
-- null and an index over them would be dead weight.
CREATE INDEX IF NOT EXISTS "ix_tasks_dev_owner" ON "work"."tasks" ("dev_owner_id")
  WHERE "dev_owner_id" IS NOT NULL;
