-- Phase 1.8: per-Project Estimation Settings (SRS §6.2).
-- Labels XS/S/M/L/XL are fixed; each carries editable point + count values.
-- Hours-per-point is a positive number consumed by Capacity Planning + Reports.
-- Workspace Admin-only editable (enforced in the service).

CREATE TABLE IF NOT EXISTS work.project_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  xs_points integer NOT NULL DEFAULT 1 CHECK (xs_points > 0),
  s_points integer NOT NULL DEFAULT 3 CHECK (s_points > 0),
  m_points integer NOT NULL DEFAULT 5 CHECK (m_points > 0),
  l_points integer NOT NULL DEFAULT 8 CHECK (l_points > 0),
  xl_points integer NOT NULL DEFAULT 13 CHECK (xl_points > 0),
  hours_per_point numeric(8, 2) NOT NULL DEFAULT 8.0 CHECK (hours_per_point > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_project_settings_project ON work.project_settings (project_id);
CREATE INDEX ix_project_settings_workspace ON work.project_settings (workspace_id);

ALTER TABLE work.project_settings
  ADD CONSTRAINT fk_project_settings_project
  FOREIGN KEY (project_id) REFERENCES work.projects(id) ON DELETE CASCADE;
