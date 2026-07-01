import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { workflowStatusCategoryEnum } from '../../../../../../../db/schema/enums';

export const CreateWorkflowStatusSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(workflowStatusCategoryEnum.enumValues),
  color: z.string().max(20).optional(),
  position: z.number().int().min(0).optional(),
  isDefault: z.boolean().optional(),
});
export class CreateWorkflowStatusDto extends createZodDto(CreateWorkflowStatusSchema) {}

export const ReorderStatusesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});
export class ReorderStatusesDto extends createZodDto(ReorderStatusesSchema) {}

export const CreateWorkflowTransitionSchema = z.object({
  fromStatusId: z.string().uuid().nullable().optional(),
  toStatusId: z.string().uuid(),
  name: z.string().max(100).optional(),
});
export class CreateWorkflowTransitionDto extends createZodDto(CreateWorkflowTransitionSchema) {}
