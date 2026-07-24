import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ── Update profile ────────────────────────────────────────────────────────────

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(255).trim().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(100).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
});

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

// ── Dev login (non-production only) ──────────────────────────────────────────

export const DevLoginSchema = z.object({
  /** Email of a seeded account. Passwordless — for local development and E2E only. */
  email: z.string().email('a valid email is required').max(320),
});

export class DevLoginDto extends createZodDto(DevLoginSchema) {}

// ── Email-first login start (multi-IdP broker) ───────────────────────────────

export const LoginStartSchema = z.object({
  /** The user's email — routed to its federated connection (directory or invited-shared). */
  email: z.string().email('a valid email is required').max(320),
  /** Same-origin path to land on after login (validated server-side). */
  returnTo: z.string().optional(),
});

export class LoginStartDto extends createZodDto(LoginStartSchema) {}

// ── Home SSO shortcut (one-click "Sign in with Microsoft", no email) ─────────

export const LoginSsoSchema = z.object({
  /** Same-origin path to land on after login (validated server-side). */
  returnTo: z.string().optional(),
});

export class LoginSsoDto extends createZodDto(LoginSsoSchema) {}

// ── Switch workspace ─────────────────────────────────────────────────────────

export const SwitchWorkspaceSchema = z.object({
  workspaceId: z.string().uuid('workspaceId must be a valid UUID'),
});

export class SwitchWorkspaceDto extends createZodDto(SwitchWorkspaceSchema) {}
