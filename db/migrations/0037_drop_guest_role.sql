-- 0037: Remove the retired `guest` system role.
--
-- `guest` held only `work_item:view:public`, which no endpoint ever enforced —
-- the role was unreachable/dead. Dropped from the catalogue; this migration
-- reconciles existing databases by removing any lingering assignments and the
-- role row. Idempotent: safe to re-run, no-op when the role is already gone.

DELETE FROM "access"."user_role_assignments"
  WHERE role_id IN (SELECT id FROM "access"."system_roles" WHERE slug = 'guest');
--> statement-breakpoint
DELETE FROM "access"."system_roles" WHERE slug = 'guest';
