import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { workItemTypeEnum, workItemScheduleStateEnum } from '../../../../../../../db/schema/enums';

export const IterationStatusMetricsSchema = z.object({
  plannedVelocityPercent: z.number().int(),
  acceptedPoints: z.number().int(),
  plannedVelocity: z.number().int(),
  acceptedPercent: z.number().int(),
  totalPlanEstimate: z.number().int(),
  daysLeft: z.number().int().nullable(),
  defectCount: z.number().int(),
  taskCount: z.number().int(),
});

export const IterationStatusItemSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string(),
  type: z.enum(workItemTypeEnum.enumValues),
  title: z.string(),
  scheduleState: z.enum(workItemScheduleStateEnum.enumValues),
  iterationId: z.string().uuid().nullable(),
  isBlocked: z.boolean(),
  blockedReason: z.string().nullable(),
  planEstimate: z.number().int().nullable(),
  taskEstimate: z.number(),
  toDo: z.number(),
  assigneeId: z.string().uuid().nullable(),
  devOwnerId: z.string().uuid().nullable(),
  rank: z.string(),
  featureKey: z.string().nullable(),
  featureTitle: z.string().nullable(),
  defectCount: z.number().int(),
  openDefectCount: z.number().int(),
  milestones: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});

export const IterationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  iterationKey: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  plannedVelocity: z.number().int().nullable(),
});

export const IterationStatusResponseSchema = z.object({
  iteration: IterationSummarySchema,
  metrics: IterationStatusMetricsSchema,
  items: z.array(IterationStatusItemSchema),
  pageInfo: z.object({
    nextCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
    limit: z.number().int(),
  }),
});

export class IterationStatusResponseDto extends createZodDto(IterationStatusResponseSchema) {}

export const CreateIterationItemResponseSchema = z.object({
  workItemId: z.string().uuid(),
  itemKey: z.string(),
});

export class CreateIterationItemResponseDto extends createZodDto(
  CreateIterationItemResponseSchema,
) {}
