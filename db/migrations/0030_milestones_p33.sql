-- P3.3 Milestones — create milestone_status enum, milestones table, and milestone_releases junction.

CREATE TYPE work.milestone_status AS ENUM (
  'planned',
  'at_risk',
  'met',
  'missed',
  'cancelled',
  'completed'
);

CREATE TABLE work.milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL,
  project_id      UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  notes           TEXT,
  status          work.milestone_status NOT NULL DEFAULT 'planned',
  owner_id        UUID,
  target_start_date DATE,
  target_end_date   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_milestones_workspace ON work.milestones (workspace_id);
CREATE INDEX ix_milestones_project   ON work.milestones (project_id);
CREATE INDEX ix_milestones_owner     ON work.milestones (owner_id);

CREATE TABLE work.milestone_releases (
  milestone_id  UUID NOT NULL,
  release_id    UUID NOT NULL,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (milestone_id, release_id)
);

CREATE INDEX ix_mr_milestone ON work.milestone_releases (milestone_id);
CREATE INDEX ix_mr_release   ON work.milestone_releases (release_id);