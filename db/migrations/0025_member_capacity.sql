-- P3.1 Team Status: member_capacity table
-- Stores per-member capacity (hours) scoped to Project/Team/Iteration.
-- SRS §8.4 — unique key on (project_id, team_id, iteration_id, user_id).

CREATE TABLE IF NOT EXISTS work.member_capacity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  project_id    UUID NOT NULL,
  team_id       UUID NOT NULL,
  iteration_id  UUID NOT NULL,
  user_id       UUID NOT NULL,
  capacity_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_member_capacity
  ON work.member_capacity (project_id, team_id, iteration_id, user_id);

CREATE INDEX ix_mc_tenant  ON work.member_capacity (tenant_id);
CREATE INDEX ix_mc_iteration ON work.member_capacity (iteration_id);
CREATE INDEX ix_mc_user ON work.member_capacity (user_id);