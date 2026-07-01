import { z } from 'zod';

const booleanish = (defaultValue: boolean) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((v) => v === 'true');

/**
 * Validated environment schema.
 * Process refuses to start if any required variable is missing or malformed.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().int().positive().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_MIGRATION_URL: z.string().url().optional(),

  // Redis / Valkey
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().default('rally:'),

  // JWT — keys may be raw PEM or base64-encoded PEM
  JWT_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((v) => (v.includes('-----BEGIN') ? v : Buffer.from(v, 'base64').toString('utf8')))
    .refine((v) => v.includes('-----BEGIN'), 'JWT_PRIVATE_KEY must be a PEM-encoded private key'),
  JWT_PUBLIC_KEY: z
    .string()
    .min(1)
    .transform((v) => (v.includes('-----BEGIN') ? v : Buffer.from(v, 'base64').toString('utf8')))
    .refine((v) => v.includes('-----BEGIN'), 'JWT_PUBLIC_KEY must be a PEM-encoded public key'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),
  JWT_ISSUER: z.string().default('rally-api'),
  JWT_AUDIENCE: z.string().default('rally-web'),

  // CSRF
  CSRF_SECRET: z.string().min(32),

  // AWS
  AWS_REGION: z.string().default('ap-southeast-1'),
  AWS_ACCOUNT_ID: z.string().optional(),
  SNS_TOPIC_ARN: z.string().optional(),
  SQS_AUDIT_URL: z.string().optional(),
  SQS_REPORTING_URL: z.string().optional(),
  SQS_SEARCH_URL: z.string().optional(),
  S3_ATTACHMENTS_BUCKET: z.string().default('rally-attachments'),
  CDN_ATTACHMENTS_BASE_URL: z.string().url().optional(),

  // ── Email ──────────────────────────────────────────────────────────────────
  /**
   * Which email transport to use. Defaults to 'dev' (logs to stdout).
   * 'ses' requires SES_FROM_EMAIL + IAM role with ses:SendEmail.
   * 'resend' requires RESEND_API_KEY + a verified domain in the Resend dashboard.
   */
  EMAIL_PROVIDER: z.enum(['ses', 'resend', 'dev']).default('dev'),
  /** Display name that appears in the From header, e.g. "Mini Rally". */
  MAIL_FROM_NAME: z.string().default('Mini Rally'),
  /** Verified sender address — used by all providers. Required when EMAIL_PROVIDER != 'dev'. */
  MAIL_FROM_EMAIL: z.string().email().optional(),
  /** Legacy alias for MAIL_FROM_EMAIL. Supported for backward-compatibility. */
  SES_FROM_EMAIL: z.string().email().optional(),
  /** Required when EMAIL_PROVIDER=resend. */
  RESEND_API_KEY: z.string().optional(),
  /** Reply-To address shown in email clients. Defaults to a no-reply alias. */
  MAIL_REPLY_TO: z.string().email().optional(),
  /** Public base URL used to build password-reset and invitation links (e.g. https://app.rally.io). */
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Observability
  OTEL_ENABLED: booleanish(false),
  OTEL_SERVICE_NAME: z.string().default('rally-api'),
  OTEL_WORKER_SERVICE_NAME: z.string().default('rally-worker'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  /** 0.0–1.0 fraction of root spans to sample. Defaults: 1.0 dev, 0.1 prod. */
  OTEL_SAMPLING_PROBABILITY: z.coerce.number().min(0).max(1).optional(),
  /** Semver string injected into OTEL resource and Pino logs. */
  SERVICE_VERSION: z.string().default('dev'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: booleanish(false),
  LOG_SQL: booleanish(false),
  LOG_HTTP_BODIES: booleanish(false),
  LOG_DEV_EMAIL_CONTENT: booleanish(false),

  // Resilience
  RESILIENCE_ENABLED: booleanish(true),

  // Rate limiting (per-user sliding window)
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  // TTL knobs — defaults match SRS but allow ops to tune without code change
  PASSWORD_RESET_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(1),
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SESSION_CLEANUP_OLDER_THAN_DAYS: z.coerce.number().int().positive().default(7),

  // SSO — Microsoft Entra ID (Azure AD) OpenID Connect
  // When both vars are set, the /v1/auth/sso endpoint becomes active.
  // Leave unset (default) to disable SSO and use email/password only.
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  /**
   * Rally tenant UUID to use for JIT-provisioned SSO users whose email doesn't
   * match any existing Rally user. Required for SSO in fresh/greenfield installs.
   */
  ENTRA_DEFAULT_TENANT_ID: z.string().uuid().optional(),

  // ── Break-glass super admin ────────────────────────────────────────────────
  /**
   * Email of the dedicated password-based break-glass account.
   * In production: inject via Secrets Manager / ECS task definition.
   * Every login fires a high-severity audit record + email alert.
   */
  BREAKGLASS_EMAIL: z.string().email().default('admin@acme.dev'),
  /**
   * Password for the break-glass account. Inject via Secrets Manager in deployed
   * environments — never hardcode. Not required at runtime (only the migrator/seed
   * uses it), but validated here so a misconfigured deployment fails fast at startup.
   */
  BREAKGLASS_PASSWORD: z.string().min(12).optional(),
  /**
   * Comma-separated SSO (Entra) emails auto-granted workspace_admin on first login.
   * Example: "nghiavt@qnsc.vn,quangld@qnsc.vn"
   */
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;
