import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Must be a valid email address'),
  password: z.string().min(1, 'Password is required'),
  // AUTH-FR: remember me affects session TTL (checked = 30d, unchecked = 24h)
  rememberMe: z.boolean().optional().default(false),
});

export class LoginDto extends createZodDto(LoginSchema) {}

// ── Change password ────────────────────────────────────────────────────────────

const PASSWORD_RULES = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// ── Sign up (self-serve) ─────────────────────────────────────────────────────

export const SignupSchema = z.object({
  email: z.string().email('Must be a valid email address'),
  password: PASSWORD_RULES,
  displayName: z.string().min(1, 'Name is required').max(255).trim(),
  /** Optional org name — used when this signup creates a brand-new tenant. */
  organizationName: z.string().min(1).max(255).trim().optional(),
});

export class SignupDto extends createZodDto(SignupSchema) {}

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PASSWORD_RULES,
});

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}

// ── Update profile ────────────────────────────────────────────────────────────

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(255).trim().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(100).optional(),
});

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

// ── Forgot password ──────────────────────────────────────────────────────────

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Must be a valid email address'),
});

export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}

// ── Reset password ───────────────────────────────────────────────────────────

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: PASSWORD_RULES,
});

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}

// ── SSO login ────────────────────────────────────────────────────────────────

export const SsoLoginSchema = z.object({
  /** Entra ID id_token obtained from MSAL handleRedirectPromise(). */
  idToken: z.string().min(1, 'idToken is required'),
});

export class SsoLoginDto extends createZodDto(SsoLoginSchema) {}

// ── Switch tenant ────────────────────────────────────────────────────────────

export const SwitchTenantSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
});

export class SwitchTenantDto extends createZodDto(SwitchTenantSchema) {}
