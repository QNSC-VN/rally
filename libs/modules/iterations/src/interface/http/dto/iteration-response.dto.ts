import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { iterationStateEnum } from '../../../../../../../db/schema/enums';

export const IterationResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
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
