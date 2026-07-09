import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

export const ReleaseQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
});
export class ReleaseQueryDto extends createZodDto(ReleaseQuerySchema) {}

const RELEASE_STATES = ['planning', 'active', 'accepted'] as const;

export const CreateReleaseSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(5000).optional(),
  theme: z.string().max(5000).optional(),
  startDate: ISO_DATE.optional(),
  releaseDate: ISO_DATE.optional(),
  state: z.enum(RELEASE_STATES).optional().default('planning'),
});
export class CreateReleaseDto extends createZodDto(CreateReleaseSchema) {}

export const UpdateReleaseSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(5000).nullable().optional(),
  theme: z.string().max(5000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  startDate: ISO_DATE.nullable().optional(),
  releaseDate: ISO_DATE.nullable().optional(),
  plannedVelocity: z.number().int().min(0).nullable().optional(),
  planEstimate: z.number().min(0).nullable().optional(),
  version: z.string().max(100).nullable().optional(),
  state: z.enum(RELEASE_STATES).optional(),
});
export class UpdateReleaseDto extends createZodDto(UpdateReleaseSchema) {}