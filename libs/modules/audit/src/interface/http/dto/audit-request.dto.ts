import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;

export const AuditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  from: z
    .string()
    .regex(ISO_DATETIME)
    .transform((v) => new Date(v))
    .optional(),
  to: z
    .string()
    .regex(ISO_DATETIME)
    .transform((v) => new Date(v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export class AuditQueryDto extends createZodDto(AuditQuerySchema) {}
