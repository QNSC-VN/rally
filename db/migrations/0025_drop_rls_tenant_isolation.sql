-- ============================================================================
-- Migration 0025: Remove RLS tenant isolation
-- ============================================================================
-- Tenancy is being dropped entirely (workspace becomes the switchable root),
-- so the entire Row-Level Security apparatus added in 0005 is removed.
--
-- Must run BEFORE the structural migration (0026) renames/drops tenant_id,
-- since every `tenant_isolation` policy references the tenant_id column.
--
-- Dynamic teardown: drop every `tenant_isolation` policy wherever it exists
-- and disable RLS on its table. This covers all tables enabled across 0005
-- and 0018 without having to enumerate them.
-- ============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'tenant_isolation'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS set_tenant_context(uuid);
