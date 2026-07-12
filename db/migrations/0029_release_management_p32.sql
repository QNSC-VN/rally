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

-- 2. Recreate enum type
ALTER TABLE work.releases DROP CONSTRAINT IF EXISTS releases_status_check;
ALTER TABLE work.releases ALTER COLUMN status DROP DEFAULT;

ALTER TYPE public.release_status RENAME TO release_status_old;
CREATE TYPE public.release_status AS ENUM ('planning', 'active', 'accepted');

-- 3. Convert the column type using CASE mapping in the USING clause
ALTER TABLE work.releases
  ALTER COLUMN status TYPE public.release_status USING (
    CASE 
      WHEN status::text = 'planned' THEN 'planning'::public.release_status
      WHEN status::text IN ('released', 'archived') THEN 'accepted'::public.release_status
      ELSE 'planning'::public.release_status
    END
  );

ALTER TABLE work.releases ALTER COLUMN status SET DEFAULT 'planning'::public.release_status;

-- 4. Clean up old enum type
DROP TYPE public.release_status_old;