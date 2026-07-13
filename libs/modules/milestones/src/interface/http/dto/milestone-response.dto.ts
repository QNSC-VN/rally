import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { milestoneStatusEnum } from '../../../../../../../db/schema/enums';

const MilestoneProgressSchema = z.object({
  totalItems: z.number(),
  completedItems: z.number(),
  totalPoints: z.number(),
  completedPoints: z.number(),
  progressPercent: z.number(),
});

export const MilestoneResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(milestoneStatusEnum.enumValues),
  ownerId: z.string().uuid().nullable(),
  targetStartDate: z
    .string()
    .nullable()
    .describe('YYYY-MM-DD, manually set or derived from linked releases'),
  targetEndDate: z
    .string()
    .nullable()
    .describe('YYYY-MM-DD, manually set or derived from linked releases'),
  releaseIds: z.array(z.string().uuid()),
  projectIds: z.array(z.string().uuid()).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
  progress: MilestoneProgressSchema.optional().describe(
    'Work-item completion across linked releases',
  ),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class MilestoneResponseDto extends createZodDto(MilestoneResponseSchema) {}

export const MilestoneListItemSchema = MilestoneResponseSchema;
export class MilestoneListItemDto extends createZodDto(MilestoneListItemSchema) {}
