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

export const AttachmentResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  uploadedBy: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string().datetime(),
});

export class AttachmentResponseDto extends createZodDto(AttachmentResponseSchema) {}
