import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Max avatar upload size — 2 MB. The authoritative bound lives on USER_AVATAR_POLICY;
 *  this DTO bound is a cheap first check before the shared AttachmentsService runs. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Raster image types accepted for avatars (kept in sync with the FE `accept`). */
export const AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

// ── Presign avatar upload ──────────────────────────────────────────────────────

export const PresignAvatarSchema = z.object({
  contentType: z.enum(AVATAR_CONTENT_TYPES),
  contentLength: z.number().int().positive().max(AVATAR_MAX_BYTES),
  /** base64-encoded SHA-256 of the file — the shared AttachmentsService binds it
   *  into the confirm-time integrity check (required by every upload surface). */
  checksumSha256: z.string().min(1),
});

export class PresignAvatarDto extends createZodDto(PresignAvatarSchema) {}

export const PresignAvatarResponseSchema = z.object({
  fileId: z.string().uuid(),
  uploadUrl: z.string().url().describe('Presigned PUT URL — expires in 5 minutes'),
  requiredHeaders: z
    .record(z.string(), z.string())
    .describe('Headers the client MUST send on the PUT — they are part of the signature.'),
});

export class PresignAvatarResponseDto extends createZodDto(PresignAvatarResponseSchema) {}

// ── Confirm avatar upload ──────────────────────────────────────────────────────

export const ConfirmAvatarSchema = z.object({
  fileId: z.string().uuid(),
});

export class ConfirmAvatarDto extends createZodDto(ConfirmAvatarSchema) {}

export const ConfirmAvatarResponseSchema = z.object({
  avatarUrl: z.string().url().describe('Durable CDN URL now stored on the user profile'),
});

export class ConfirmAvatarResponseDto extends createZodDto(ConfirmAvatarResponseSchema) {}
