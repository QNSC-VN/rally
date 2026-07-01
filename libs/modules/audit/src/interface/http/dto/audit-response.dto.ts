import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AuditLogResponseSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorEmail: z.string().email().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  projectId: z.string().uuid().nullable(),
  changes: z.record(z.string(), z.unknown()).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
});

export class AuditLogResponseDto extends createZodDto(AuditLogResponseSchema) {}
