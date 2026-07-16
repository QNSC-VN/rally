import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';
import { iterationStateEnum } from '../../../../../../../db/schema/enums';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

// ── List query ────────────────────────────────────────────────────────────────

export const IterationQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  state: z.enum(iterationStateEnum.enumValues).optional(),
  q: z.string().max(255).optional(),
  sortBy: z.enum(['name', 'theme', 'startDate', 'endDate', 'state', 'plannedVelocity']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export class IterationQueryDto extends createZodDto(IterationQuerySchema) {}

// ── Create ────────────────────────────────────────────────────────────────────

export const CreateIterationSchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  name: z.string().min(1).max(255).trim(),
  goal: z.string().max(2000).optional(),
  theme: z.string().max(20000).optional(),
  notes: z.string().max(20000).optional(),
  state: z.enum(iterationStateEnum.enumValues).optional(),
  startDate: ISO_DATE.optional(),
  endDate: ISO_DATE.optional(),
  plannedVelocity: z.number().int().min(0).optional(),
});

export class CreateIterationDto extends createZodDto(CreateIterationSchema) {}

// ── Update ────────────────────────────────────────────────────────────────────

export const UpdateIterationSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  goal: z.string().max(2000).nullable().optional(),
  theme: z.string().max(20000).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  state: z.enum(iterationStateEnum.enumValues).optional(),
  startDate: ISO_DATE.nullable().optional(),
  endDate: ISO_DATE.nullable().optional(),
  plannedVelocity: z.number().int().min(0).nullable().optional(),
});

export class UpdateIterationDto extends createZodDto(UpdateIterationSchema) {}

// ── Accept iteration (carry-over target for unfinished items) ────────────────────

export const RolloverIterationSchema = z.object({
  /**
   * Optional target iteration for the unfinished items.
   * If omitted, unfinished items are moved back to the backlog (iterationId = null).
   */
  moveToIterationId: z.string().uuid().optional(),
});

export class RolloverIterationDto extends createZodDto(RolloverIterationSchema) {}

// ── Assignment options query (P2-IT-10) ──────────────────────────────────

export const IterationAssignmentOptionsQuerySchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
});

export class IterationAssignmentOptionsQueryDto extends createZodDto(
  IterationAssignmentOptionsQuerySchema,
) {}
