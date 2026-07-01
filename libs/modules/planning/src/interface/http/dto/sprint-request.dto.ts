import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

// ── List query ────────────────────────────────────────────────────────────────

export const SprintQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
});

export class SprintQueryDto extends createZodDto(SprintQuerySchema) {}

// ── Create ────────────────────────────────────────────────────────────────────

export const CreateSprintSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255).trim(),
  goal: z.string().max(2000).optional(),
  startDate: ISO_DATE.optional(),
  endDate: ISO_DATE.optional(),
});

export class CreateSprintDto extends createZodDto(CreateSprintSchema) {}

// ── Update ────────────────────────────────────────────────────────────────────

export const UpdateSprintSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  goal: z.string().max(2000).nullable().optional(),
  startDate: ISO_DATE.nullable().optional(),
  endDate: ISO_DATE.nullable().optional(),
});

export class UpdateSprintDto extends createZodDto(UpdateSprintSchema) {}

// ── Complete sprint ───────────────────────────────────────────────────────────

export const CompleteSprintSchema = z.object({
  /**
   * Optional target sprint for unfinished items.
   * If omitted, unfinished items are moved to the backlog (iterationId = null).
   */
  moveToSprintId: z.string().uuid().optional(),
});

export class CompleteSprintDto extends createZodDto(CompleteSprintSchema) {}
