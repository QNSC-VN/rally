import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CommentResponseSchema = z.object({
  id: z.string().uuid(),
  /** The subject this comment hangs off (0082). Replaced `workItemId`. */
  entityType: z.enum(['work_item', 'portfolio_item']),
  entityId: z.string().uuid(),
  authorId: z.string().uuid(),
  body: z.string(),
  parentId: z.string().uuid().nullable(),
  isEdited: z.boolean(),
  editedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class CommentResponseDto extends createZodDto(CommentResponseSchema) {}

/**
 * One mapper for every comment surface. Lives with the DTO rather than in a controller so
 * the work-item and portfolio routes cannot render the same row differently.
 */
export function toCommentDto(c: {
  id: string;
  entityType: 'work_item' | 'portfolio_item';
  entityId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  isEdited: boolean;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CommentResponseDto {
  return {
    id: c.id,
    entityType: c.entityType,
    entityId: c.entityId,
    authorId: c.authorId,
    body: c.body,
    parentId: c.parentId,
    isEdited: c.isEdited,
    editedAt: c.editedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
