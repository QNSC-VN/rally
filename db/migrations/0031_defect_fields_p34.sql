-- P3.4 Quality/Defect — add defect-specific fields to work_items.

-- Severity enum
CREATE TYPE work.defect_severity AS ENUM ('critical', 'high', 'medium', 'low');

-- Environment enum
CREATE TYPE work.defect_environment AS ENUM ('development', 'staging', 'production', 'testing');

-- Add defect-specific columns (nullable — only used when type = 'defect')
ALTER TABLE work.work_items
  ADD COLUMN severity      work.defect_severity,
  ADD COLUMN found_in_environment work.defect_environment,
  ADD COLUMN found_in_release_id  UUID REFERENCES work.releases(id) ON DELETE SET NULL;

-- Index for filtering defects by release
CREATE INDEX ix_wi_found_in_release ON work.work_items (found_in_release_id)
  WHERE type = 'defect' AND deleted_at IS NULL;

-- Index for filtering defects by severity
CREATE INDEX ix_wi_defect_severity ON work.work_items (workspace_id, severity)
  WHERE type = 'defect' AND deleted_at IS NULL;