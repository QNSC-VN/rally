-- Give workspace-scoped project_member (Editor) tier roles the §5 Editor view codes:
-- quality:view and team_status:view. The catalog gained both (P4-RBAC-006: the Editor's
-- own §5 rows grant Quality Defects View = Assigned Teams and Team Status View, and the
-- nav shows both surfaces — without the codes every Editor 403'd all of Quality and
-- Team Status). Companion to 0109, which REMOVED the three admin/report view codes from
-- the same tier.
--
-- Safe to force rather than merge, exactly like 0092: both codes are NEW to this tier
-- (nobody can have deliberately revoked what never existed), so adding them cannot undo
-- an admin's decision. Idempotent via the NOT @> guard. No updated_at (created_at only).

UPDATE access.system_roles
SET permissions = permissions || '["quality:view"]'::jsonb
WHERE slug = 'project_member'
  AND workspace_id IS NOT NULL
  AND NOT (permissions @> '["quality:view"]'::jsonb);

UPDATE access.system_roles
SET permissions = permissions || '["team_status:view"]'::jsonb
WHERE slug = 'project_member'
  AND workspace_id IS NOT NULL
  AND NOT (permissions @> '["team_status:view"]'::jsonb);
