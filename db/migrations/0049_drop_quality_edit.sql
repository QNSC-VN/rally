-- Remove the dead `quality:edit` permission from all stored role grants.
--
-- The quality module is a read-only defect dashboard: the only endpoint,
-- GET /quality/defects, is guarded by `quality:view`. Defects ARE work items,
-- so their create/edit/delete is enforced through the work_item namespace
-- (`work_item:edit`). `quality:edit` was never checked by any endpoint — it was
-- a phantom grant that only the frontend gated on, which the app now derives
-- from `work_item:edit` instead. Dropping it keeps a single source of truth for
-- "can mutate a defect".
--
-- Every seeded role that carried `quality:edit` also carries `work_item:edit`,
-- so no effective capability changes. Idempotent: only touches rows that still
-- hold the code.

UPDATE "access"."system_roles"
SET "permissions" = "permissions" - 'quality:edit'
WHERE "permissions" ? 'quality:edit';
