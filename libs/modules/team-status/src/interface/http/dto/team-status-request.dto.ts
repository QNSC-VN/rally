import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ── GET /team-status ─────────────────────────────────────────────────────

export const TeamStatusQuerySchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional().nullable(),
  iterationId: z.string().uuid(),
});
export class TeamStatusQueryDto extends createZodDto(TeamStatusQuerySchema) {}

// ── PATCH /team-status/capacity ──────────────────────────────────────────

export const UpdateCapacitySchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  iterationId: z.string().uuid(),
  userId: z.string().uuid(),
  capacityHours: z.number().min(0),
});
export class UpdateCapacityDto extends createZodDto(UpdateCapacitySchema) {}

// ── PATCH /team-status/tasks/:taskId ─────────────────────────────────────

const TEAM_TASK_STATES = ['Defined', 'In-Progress', 'Completed'] as const;

/**
 * Team Status edits exactly two task fields: Task Name and Task State.
 *
 * SRS §9.3 is one line — "Accept partial patch for `title` and/or `state`" — and §11's permission
 * table has exactly three editable columns for this surface: Edit Capacity, Edit Task Name, Edit
 * Task State. Everything else on the grid is a READ: FR-026 "Estimate, ToDo and Actuals are SHOWN
 * as numeric hour values", FR-027 "Owner column DISPLAYS the task owner name", and §7 sources the
 * hours "from task estimate/remaining/actual rollups". AC-16/17 name Task Name and State as the
 * inline-editable pair and nothing else.
 *
 * The four fields that used to be here — `estimateHours`, `todoHours`, `actualHours`, `assigneeId`
 * — are editable on the TASK DASHBOARD (Work Item Detail › Tasks tab, FR-038/AC-24), which is a
 * different surface writing through `PATCH /work-items/:id`. So the capability is not lost; it is
 * where the BA puts it. Editing Owner from a row nested inside its owner's own group was
 * incoherent anyway: the row leaves the group it is drawn in.
 *
 * `.strict()`, so a client that still sends one gets a 400 instead of a silent strip. A discarded
 * write that answers 200 is the worst of the three outcomes — the grid would show the value until
 * the next refetch. Same reasoning as `TASK_ITERATION_DERIVED` refusing a derived field outright.
 */
export const UpdateTeamTaskSchema = z
  .object({
    title: z.string().min(1).max(500).trim().optional(),
    state: z.enum(TEAM_TASK_STATES).optional(),
  })
  .strict();
export class UpdateTeamTaskDto extends createZodDto(UpdateTeamTaskSchema) {}
