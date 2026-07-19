-- Split the coarse `<ns>:manage` grants into explicit create/edit/delete leaves
-- for the iteration, release and milestone namespaces, matching the catalogue in
-- db/permissions.catalog.ts. `manage` bundled create+edit+delete behind one code,
-- which could not be assigned independently; the split lets an admin grant, say,
-- "plan releases but not delete them" without a schema change.
--
-- Rewrites every stored role's permission set (both the global templates and the
-- per-workspace editable copies, plus any custom roles). Assignments reference a
-- role by id and carry no permission copy, so nothing else needs rewriting.
--
-- Idempotent: each statement only touches rows that still carry the old code, so
-- a re-run is a no-op. jsonb_agg(DISTINCT …) also dedupes if a leaf was somehow
-- already present.

UPDATE "access"."system_roles"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT elem)
  FROM jsonb_array_elements(
    ("permissions" - 'iteration:manage')
    || '["iteration:create","iteration:edit","iteration:delete"]'::jsonb
  ) AS elem
)
WHERE "permissions" ? 'iteration:manage';

UPDATE "access"."system_roles"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT elem)
  FROM jsonb_array_elements(
    ("permissions" - 'release:manage')
    || '["release:create","release:edit","release:delete"]'::jsonb
  ) AS elem
)
WHERE "permissions" ? 'release:manage';

UPDATE "access"."system_roles"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT elem)
  FROM jsonb_array_elements(
    ("permissions" - 'milestone:manage')
    || '["milestone:create","milestone:edit","milestone:delete"]'::jsonb
  ) AS elem
)
WHERE "permissions" ? 'milestone:manage';
