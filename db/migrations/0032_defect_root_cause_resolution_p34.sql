-- P3.4: Add root cause and resolution fields to work_items (defect-specific)
CREATE TYPE defect_root_cause AS ENUM ('requirements', 'design', 'code', 'test', 'integration', 'other');
CREATE TYPE defect_resolution AS ENUM ('fixed', 'wont_fix', 'duplicate', 'cannot_reproduce', 'deferred', 'by_design');

ALTER TABLE work.work_items ADD COLUMN root_cause defect_root_cause;
ALTER TABLE work.work_items ADD COLUMN resolution defect_resolution;

CREATE INDEX ix_wi_defect_root_cause ON work.work_items (root_cause) WHERE type = 'defect' AND deleted_at IS NULL;
CREATE INDEX ix_wi_defect_resolution ON work.work_items (resolution) WHERE type = 'defect' AND deleted_at IS NULL;
