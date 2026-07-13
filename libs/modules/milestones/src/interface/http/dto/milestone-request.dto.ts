import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

export const MilestoneQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
});
export class MilestoneQueryDto extends createZodDto(MilestoneQuerySchema) {}

export const CreateMilestoneSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(5000).optional(),
  notes: z.string().max(10000).optional(),
  status: z.enum(['planned', 'at_risk', 'met', 'missed', 'cancelled', 'completed']).optional(),
  ownerId: z.string().uuid().optional(),
  targetStartDate: z.string().date().optional(),
  targetEndDate: z.string().date().optional(),
  releaseIds: z.array(z.string().uuid()),
  projectIds: z.array(z.string().uuid()).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
});
export class CreateMilestoneDto extends createZodDto(CreateMilestoneSchema) {}

export const UpdateMilestoneSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(5000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  status: z.enum(['planned', 'at_risk', 'met', 'missed', 'cancelled', 'completed']).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  targetStartDate: z.string().date().nullable().optional(),
  targetEndDate: z.string().date().nullable().optional(),
  releaseIds: z.array(z.string().uuid()).optional(),
  projectIds: z.array(z.string().uuid()).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
});
export class UpdateMilestoneDto extends createZodDto(UpdateMilestoneSchema) {}