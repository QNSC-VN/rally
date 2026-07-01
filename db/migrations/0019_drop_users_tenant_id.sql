-- Migration: 0019_drop_users_tenant_id
-- Phase 4 of the global-identity refactor.
-- Drops users.tenant_id — the column that tied each user to exactly one tenant.
-- After Phase 2+3 every user's home-tenant is resolved via tenancy.tenant_members
-- ("keycards") instead. This makes the column safe to remove.
--
-- Steps:
--  1. Replace the RLS policy on identity.users with a members-only clause
--     (removes the transitional tenant_id = ? OR EXISTS(...) dual-clause that
--      was put in place by migration 0018).
--  2. Drop the composite unique index that includes tenant_id.
--  3. Drop the plain tenant index on users.
--  4. Drop the tenant_id column itself.

-- Step 1: Update the RLS policy to use ONLY tenant_members
ALTER POLICY tenant_isolation ON identity.users
  USING (
    EXISTS (
      SELECT 1
      FROM tenancy.tenant_members tm
      WHERE tm.user_id = users.id
        AND tm.tenant_id = current_setting('app.tenant_id')::uuid
        AND tm.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tenancy.tenant_members tm
      WHERE tm.user_id = users.id
        AND tm.tenant_id = current_setting('app.tenant_id')::uuid
        AND tm.status = 'active'
    )
  );

-- Step 2: Drop the composite (tenant_id, email) unique index
DROP INDEX IF EXISTS identity.uq_users_tenant_email;

-- Step 3: Drop the plain tenant index
DROP INDEX IF EXISTS identity.ix_users_tenant;

-- Step 4: Drop the column (CASCADE removes any view or computed column depending on it)
ALTER TABLE identity.users DROP COLUMN IF EXISTS tenant_id CASCADE;
