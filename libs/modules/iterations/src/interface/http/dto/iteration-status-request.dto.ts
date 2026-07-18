import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';
import { workItemTypeEnum, workItemScheduleStateEnum } from '../../../../../../../db/schema/enums';

// ── Iteration Status list query (P2-IS-04) ──────────────────────────────────────

export const IterationStatusQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(255).optional(),
  type: z.enum(workItemTypeEnum.enumValues).optional(),
  scheduleState: z.enum(workItemScheduleStateEnum.enumValues).optional(),
  isBlocked: z.coerce.boolean().optional(),
  assigneeId: z.string().uuid().optional(),
  sortBy: z
    .enum([
      'rank',
      'itemKey',
      'type',
      'title',
      'scheduleState',
      'planEstimate',
      'taskEstimate',
      'toDo',
    ])
    .optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export class IterationStatusQueryDto extends createZodDto(IterationStatusQuerySchema) {}

// ── Create Story/Defect into the iteration (P2-IS-06) ────────────────────────────

export const CreateIterationItemSchema = z.object({
  // P2.3 restricts creation to story/defect (SRS §9.4 / FR-041).
  type: z.enum(['story', 'defect']),
  title: z.string().min(1).max(500).trim(),
  assigneeId: z.string().uuid().optional(),
  // story_points is numeric(6,2): accept fractional plan estimates and normalise
  // to a 2dp string for the numeric column (SRS §9.4).
  planEstimate: z.coerce
    .number()
    .min(0)
    .max(999)
    .transform((v) => v.toFixed(2))
    .optional(),
});

export class CreateIterationItemDto extends createZodDto(CreateIterationItemSchema) {}
