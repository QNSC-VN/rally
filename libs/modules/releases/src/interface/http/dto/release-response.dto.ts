import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { releaseStatusEnum } from '../../../../../../../db/schema/enums';

export const ReleaseResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(releaseStatusEnum.enumValues),
  targetDate: z.string().nullable().describe('YYYY-MM-DD'),
  releasedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ReleaseResponseDto extends createZodDto(ReleaseResponseSchema) {}
