import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { iterationStateEnum } from '../../../../../../../db/schema/enums';

export const IterationResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  teamId: z.string().uuid().nullable(),
  iterationKey: z.string().nullable(),
  name: z.string(),
  goal: z.string().nullable(),
  theme: z.string().nullable(),
  notes: z.string().nullable(),
  state: z.enum(iterationStateEnum.enumValues),
  plannedVelocity: z.number().int().nullable(),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  endDate: z.string().nullable().describe('YYYY-MM-DD'),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class IterationResponseDto extends createZodDto(IterationResponseSchema) {}

// ── Compact picker option (P2-IT-10) ──────────────────────────────────────────

export const IterationOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  iterationKey: z.string().nullable(),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  endDate: z.string().nullable().describe('YYYY-MM-DD'),
  state: z.enum(iterationStateEnum.enumValues),
});

export class IterationOptionDto extends createZodDto(IterationOptionSchema) {}

// ── Activity (Revision History) ─────────────────────────────────────────────

export const IterationActivityResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  /** Display name of the actor, resolved server-side. */
  actorName: z.string().nullable(),
  action: z.string(),
  changes: z.object({ field: z.string(), old: z.unknown(), new: z.unknown() }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export class IterationActivityResponseDto extends createZodDto(IterationActivityResponseSchema) {}
