import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CommentResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  authorId: z.string().uuid(),
  body: z.string(),
  parentId: z.string().uuid().nullable(),
  isEdited: z.boolean(),
  editedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class CommentResponseDto extends createZodDto(CommentResponseSchema) {}
