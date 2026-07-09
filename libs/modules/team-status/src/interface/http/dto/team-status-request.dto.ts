import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ── GET /team-status ─────────────────────────────────────────────────────

export const TeamStatusQuerySchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid(),
  iterationId: z.string().uuid(),
});
export class TeamStatusQueryDto extends createZodDto(TeamStatusQuerySchema) {}

// ── PATCH /team-status/capacity ──────────────────────────────────────────

export const UpdateCapacitySchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid(),
  iterationId: z.string().uuid(),
  userId: z.string().uuid(),
  capacityHours: z.number().min(0),
});
export class UpdateCapacityDto extends createZodDto(UpdateCapacitySchema) {}

// ── PATCH /team-status/tasks/:taskId ─────────────────────────────────────

const TEAM_TASK_STATES = ['Defined', 'In-Progress', 'Completed'] as const;

export const UpdateTeamTaskSchema = z.object({
  title: z.string().min(1).max(500).trim().optional(),
  state: z.enum(TEAM_TASK_STATES).optional(),
});
export class UpdateTeamTaskDto extends createZodDto(UpdateTeamTaskSchema) {}