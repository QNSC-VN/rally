import { z } from 'zod';

export const PageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
  limit: z.number().int(),
});

export const PagedResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: z.array(dataSchema),
    pageInfo: PageInfoSchema,
  });

export type PageInfo = z.infer<typeof PageInfoSchema>;
