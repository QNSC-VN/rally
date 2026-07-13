-- Phase 3 structural changes
-- 1. Defect state enum (separate from schedule state / flow state)
CREATE TYPE work.defect_state AS ENUM ('submitted', 'open', 'fixed', 'closed', 'closed_declined');

-- 2. Task state enum
CREATE TYPE work.task_state AS ENUM ('defined', 'in_progress', 'completed');

-- 3. Add release_notes to releases
ALTER TABLE work.releases ADD COLUMN IF NOT EXISTS release_notes text;

-- 4. Add defect_state and fixed_in_build to work_items
ALTER TABLE work.work_items ADD COLUMN IF NOT EXISTS defect_state work.defect_state;
ALTER TABLE work.work_items ADD COLUMN IF NOT EXISTS fixed_in_build varchar(255);

-- 5. Create separate tasks table
CREATE TABLE work.tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    parent_id uuid NOT NULL REFERENCES work.work_items(id) ON DELETE CASCADE,
    title varchar(500) NOT NULL,
    description text,
    state work.task_state NOT NULL DEFAULT 'defined',
    assignee_id uuid,
    team_id uuid,
    iteration_id uuid,
    estimate_hours numeric(8,2),
    todo_hours numeric(8,2),
    actual_hours numeric(8,2),
    rank varchar(255) NOT NULL DEFAULT '',
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX ix_tasks_workspace ON work.tasks(workspace_id);
CREATE INDEX ix_tasks_project ON work.tasks(project_id);
CREATE INDEX ix_tasks_parent ON work.tasks(parent_id);
CREATE INDEX ix_tasks_iteration ON work.tasks(iteration_id);
CREATE INDEX ix_tasks_assignee ON work.tasks(assignee_id);
CREATE INDEX ix_tasks_team ON work.tasks(team_id);
CREATE INDEX ix_tasks_rank ON work.tasks(parent_id, rank);

-- 6. Migrate existing task-type work_items to the new tasks table
INSERT INTO work.tasks (id, workspace_id, project_id, parent_id, title, description, state, assignee_id, team_id, iteration_id, estimate_hours, todo_hours, actual_hours, rank, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT 
    wi.id, wi.workspace_id, wi.project_id, wi.parent_id, wi.title, wi.description,
    -- Cast to text so the literals below are plain strings, not references to
    -- enum values. 'ready' is added to work_item_schedule_state in 0034, and
    -- Postgres forbids using a newly-ADDED enum value in the same transaction
    -- as an existing (pre-committed) type (error 55P04, check_safe_enum_use).
    -- Drizzle runs all pending migrations in ONE transaction, so on any DB that
    -- already had the enum committed (develop/prod) this would abort the batch;
    -- ::text sidesteps the check while producing identical results.
    CASE wi.schedule_state::text
        WHEN 'idea' THEN 'defined'
        WHEN 'defined' THEN 'defined'
        WHEN 'ready' THEN 'defined'
        WHEN 'in_progress' THEN 'in_progress'
        WHEN 'completed' THEN 'completed'
        WHEN 'accepted' THEN 'completed'
        WHEN 'released' THEN 'completed'
        ELSE 'defined'
    END::work.task_state,
    wi.assignee_id, wi.team_id, wi.iteration_id, wi.estimate_hours, wi.todo_hours, wi.actual_hours,
    wi.rank, wi.created_by, wi.updated_by, wi.created_at, wi.updated_at, wi.deleted_at
FROM work.work_items wi
WHERE wi.type = 'task' AND wi.parent_id IS NOT NULL;

-- 7. Delete migrated task rows from work_items (keep only non-task types)
-- Soft-delete rather than hard-delete to preserve references
UPDATE work.work_items SET deleted_at = now() WHERE type = 'task' AND parent_id IS NOT NULL;

-- 8. Milestone multi-project junction table
CREATE TABLE work.milestone_projects (
    milestone_id uuid NOT NULL,
    project_id uuid NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (milestone_id, project_id)
);
CREATE INDEX ix_mp_milestone ON work.milestone_projects(milestone_id);
CREATE INDEX ix_mp_project ON work.milestone_projects(project_id);

-- 9. Milestone multi-team junction table
CREATE TABLE work.milestone_teams (
    milestone_id uuid NOT NULL,
    team_id uuid NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (milestone_id, team_id)
);
CREATE INDEX ix_mt_milestone ON work.milestone_teams(milestone_id);
CREATE INDEX ix_mt_team ON work.milestone_teams(team_id);

-- 10. Milestone artifacts junction table (US/DE assigned to milestone)
CREATE TABLE work.milestone_artifacts (
    milestone_id uuid NOT NULL,
    work_item_id uuid NOT NULL REFERENCES work.work_items(id) ON DELETE CASCADE,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (milestone_id, work_item_id)
);
CREATE INDEX ix_ma_milestone ON work.milestone_artifacts(milestone_id);
CREATE INDEX ix_ma_work_item ON work.milestone_artifacts(work_item_id);

-- 11. Update severity enum to add 'none' (P3.4 requirement)
ALTER TYPE work.defect_severity ADD VALUE IF NOT EXISTS 'none';

-- 12. Update work.defect_severity enum values to match SRS labels
-- Rename: high -> major_problem, medium -> minor_problem, low -> trivial
-- NOTE: We keep the existing values and handle label mapping in the application layer
-- to avoid breaking existing data. The application will map:
--   critical -> Critical, high -> Major Problem, medium -> Minor Problem, low -> Trivial, none -> None