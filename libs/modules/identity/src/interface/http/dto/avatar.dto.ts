import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Max avatar upload size — 2 MB. Bound into the presigned PUT signature. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Raster image types accepted for avatars (kept in sync with the FE `accept`). */
export const AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

// ── Presign avatar upload ──────────────────────────────────────────────────────

export const PresignAvatarSchema = z.object({
  contentType: z.enum(AVATAR_CONTENT_TYPES),
  contentLength: z.number().int().positive().max(AVATAR_MAX_BYTES),
});

export class PresignAvatarDto extends createZodDto(PresignAvatarSchema) {}

export const PresignAvatarResponseSchema = z.object({
  uploadUrl: z.string().url().describe('Presigned PUT URL — expires in 5 minutes'),
  publicUrl: z.string().url().describe('CDN URL the uploaded avatar resolves at once stored'),
});

export class PresignAvatarResponseDto extends createZodDto(PresignAvatarResponseSchema) {}
