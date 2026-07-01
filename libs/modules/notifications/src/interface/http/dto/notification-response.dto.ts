import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const NotificationResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  isRead: z.boolean(),
  readAt: z.string().datetime().nullable(),
  actorId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

export class NotificationResponseDto extends createZodDto(NotificationResponseSchema) {}
