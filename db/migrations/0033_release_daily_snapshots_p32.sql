-- P3.2: Release daily snapshots for burndown chart
CREATE TABLE work.release_daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES work.releases(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  completed_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  remaining_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_rds_release_date ON work.release_daily_snapshots (release_id, snapshot_date);
CREATE INDEX ix_rds_release ON work.release_daily_snapshots (release_id);