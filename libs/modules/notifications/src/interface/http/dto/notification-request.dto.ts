import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

export const ListNotificationsSchema = z.object({
  unreadOnly: z
    .string()
    .transform((v) => v === 'true')
    .optional()
    .default(() => false),
  limit: PageQuerySchema.shape.limit,
});
export class ListNotificationsDto extends createZodDto(ListNotificationsSchema) {}
