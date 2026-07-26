import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Query for `GET .../:id/activity` — shared across every entity's detail route. */
export const ActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export class ActivityQueryDto extends createZodDto(ActivityQuerySchema) {}

/** One Revision-History row — shared response shape for every entity. */
export const ActivityResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  /** Display name of the actor, resolved server-side. */
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  changes: z.object({ field: z.string(), old: z.unknown(), new: z.unknown() }).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export class ActivityResponseDto extends createZodDto(ActivityResponseSchema) {}

export const ActivityPageSchema = z.object({
  data: z.array(ActivityResponseSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export class ActivityPageDto extends createZodDto(ActivityPageSchema) {}
