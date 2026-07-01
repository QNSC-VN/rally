import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ListNotificationsSchema = z.object({
  unreadOnly: z
    .string()
    .transform((v) => v === 'true')
    .optional()
    .default(() => false),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(() => 50),
});
export class ListNotificationsDto extends createZodDto(ListNotificationsSchema) {}
