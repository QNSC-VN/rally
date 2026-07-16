import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateCommentSchema = z.object({
  body: z.string().min(1).max(50_000),
  parentId: z.string().uuid().optional(),
  /** F7 — user ids @mentioned in the comment body (drives mention notifications). */
  mentionedUserIds: z.array(z.string().uuid()).max(50).optional(),
});
export class CreateCommentDto extends createZodDto(CreateCommentSchema) {}

export const UpdateCommentSchema = z.object({
  body: z.string().min(1).max(50_000),
});
export class UpdateCommentDto extends createZodDto(UpdateCommentSchema) {}

export const CreateAttachmentSchema = z.object({
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(1),
  storageKey: z.string().min(1).max(1000),
});
export class CreateAttachmentDto extends createZodDto(CreateAttachmentSchema) {}
