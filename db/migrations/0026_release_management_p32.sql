-- P3.2 Release Management: enhance releases table
-- Adds Phase 3 fields: theme, notes, start_date, release_date,
-- planned_velocity, plan_estimate, version.
-- Migrates status enum from [planned, released, archived] to [planning, active, accepted].

-- 1. Add new columns
ALTER TABLE work.releases
  ADD COLUMN IF NOT EXISTS theme TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS release_date DATE,
  ADD COLUMN IF NOT EXISTS planned_velocity INTEGER,
  ADD COLUMN IF NOT EXISTS plan_estimate NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version VARCHAR(100);

-- 2. Migrate existing status values
-- planned → planning, released → accepted, archived → accepted
UPDATE work.releases SET status = 'planning' WHERE status = 'planned';
UPDATE work.releases SET status = 'accepted' WHERE status IN ('released', 'archived');

-- 3. Recreate enum type
ALTER TABLE work.releases DROP CONSTRAINT IF EXISTS releases_status_check;
ALTER TYPE work.release_status RENAME TO release_status_old;
CREATE TYPE work.release_status AS ENUM ('planning', 'active', 'accepted');
ALTER TABLE work.releases
  ALTER COLUMN status TYPE work.release_status USING status::text::work.release_status;
DROP TYPE work.release_status_old;

-- 4. Update DB-level enum in enums.ts (done in code — this migration handles the DB side)