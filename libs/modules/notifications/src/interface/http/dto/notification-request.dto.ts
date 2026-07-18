import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

export const ListNotificationsSchema = z.object({
  unreadOnly: z
    .string()
    .transform((v) => v === 'true')
    .optional()
    .default(() => false),
  // Notification Center category tabs (Assigned / Mentions). Omitted = All.
  category: z.enum(['assigned', 'mentions']).optional(),
  limit: PageQuerySchema.shape.limit,
});
export class ListNotificationsDto extends createZodDto(ListNotificationsSchema) {}
