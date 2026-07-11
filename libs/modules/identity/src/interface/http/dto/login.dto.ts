import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ── Update profile ────────────────────────────────────────────────────────────

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(255).trim().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(100).optional(),
});

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

// ── Dev login (non-production only) ──────────────────────────────────────────

export const DevLoginSchema = z.object({
  /** Email of a seeded account. Passwordless — for local development and E2E only. */
  email: z.string().email('a valid email is required').max(320),
});

export class DevLoginDto extends createZodDto(DevLoginSchema) {}
// ── Switch workspace ─────────────────────────────────────────────────────────

export const SwitchWorkspaceSchema = z.object({
  workspaceId: z.string().uuid('workspaceId must be a valid UUID'),
});

export class SwitchWorkspaceDto extends createZodDto(SwitchWorkspaceSchema) {}
