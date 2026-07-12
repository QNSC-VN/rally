-- Phase 3 fixes: add 'ready' schedule state, dev_owner_id column, and found_in_release FK

-- 1. Add 'ready' to the work_item_schedule_state enum
ALTER TYPE work_item_schedule_state ADD VALUE IF NOT EXISTS 'ready';

-- 2. Add dev_owner_id column to work.work_items
ALTER TABLE work.work_items ADD COLUMN IF NOT EXISTS dev_owner_id UUID REFERENCES identity.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_wi_dev_owner ON work.work_items (dev_owner_id) WHERE deleted_at IS NULL;

-- 3. Ensure FK constraint exists for found_in_release_id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wi_found_in_release') THEN
    ALTER TABLE work.work_items ADD CONSTRAINT fk_wi_found_in_release FOREIGN KEY (found_in_release_id) REFERENCES work.releases(id) ON DELETE SET NULL;
  END IF;
END $$;