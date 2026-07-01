import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * PUT /notifications/preferences/:type
 * At least one channel must be specified.
 */
export const UpsertPreferenceSchema = z
  .object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
  })
  .refine((d) => d.inApp !== undefined || d.email !== undefined, {
    message: 'At least one channel (inApp or email) must be specified.',
  });

export class UpsertPreferenceDto extends createZodDto(UpsertPreferenceSchema) {}
