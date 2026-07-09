import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RELEASE_STATES = ['planning', 'active', 'accepted'] as const;

const ReleaseListItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  theme: z.string().nullable(),
  status: z.enum(RELEASE_STATES),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  releaseDate: z.string().nullable().describe('YYYY-MM-DD'),
  plannedVelocity: z.number().nullable(),
  planEstimate: z.number().nullable(),
  projectName: z.string().optional(),
});

export const ReleaseResponseSchema = ReleaseListItemSchema.extend({
  notes: z.string().nullable(),
  version: z.string().nullable(),
  releasedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ReleaseResponseDto extends createZodDto(ReleaseResponseSchema) {}

export class ReleaseListItemDto extends createZodDto(ReleaseListItemSchema) {}