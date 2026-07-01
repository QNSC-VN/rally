import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

export const ReleaseQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
});
export class ReleaseQueryDto extends createZodDto(ReleaseQuerySchema) {}

export const CreateReleaseSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(2000).optional(),
  targetDate: ISO_DATE.optional(),
});
export class CreateReleaseDto extends createZodDto(CreateReleaseSchema) {}

export const UpdateReleaseSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(2000).nullable().optional(),
  targetDate: ISO_DATE.nullable().optional(),
});
export class UpdateReleaseDto extends createZodDto(UpdateReleaseSchema) {}
