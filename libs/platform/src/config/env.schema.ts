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
  /** Set to 'true' in local dev / CI to bypass all rate limiting. Never set in production. */
  DISABLE_RATE_LIMIT: booleanish(false),

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

  // TTL knobs — defaults match SRS but allow ops to tune without code change
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SESSION_CLEANUP_OLDER_THAN_DAYS: z.coerce.number().int().positive().default(7),

  // SSO — Microsoft Entra ID (Azure AD) OpenID Connect
  // Rally authenticates exclusively through the server-side BFF flow, so these
  // Entra credentials are mandatory in every environment; the API refuses to
  // boot without them.
  ENTRA_TENANT_ID: z.string().min(1),
  ENTRA_CLIENT_ID: z.string().min(1),

  // ── BFF (Backend-for-Frontend) — server-side OIDC session ──────────────────
  // The API is a *confidential* OIDC client: it runs the Authorization-Code +
  // PKCE flow server-side and issues an opaque, httpOnly `__Host-` session
  // cookie, so Entra/JWT tokens never reach the browser. This is rally's sole
  // authentication mode — every /bff/* route is always active.
  /** Entra confidential-client secret. */
  ENTRA_CLIENT_SECRET: z.string().min(1),
  /**
   * Absolute URL of the BFF OIDC callback, registered as a redirect URI on the
   * Entra app registration, e.g. https://rally-dev.qnsc.vn/v1/bff/callback.
   */
  ENTRA_REDIRECT_URI: z.string().url(),
  /**
   * Same-origin path the browser lands on after a successful BFF login when no
   * safe `returnTo` was supplied. Must be a root-relative path.
   */
  BFF_POST_LOGIN_REDIRECT: z.string().default('/'),
  /** Server-side BFF session lifetime (seconds). Defaults to 30 days. */
  BFF_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60),

  /**
   * Comma-separated SSO (Entra) emails auto-granted workspace_admin on first login.
   * Example: "nghiavt@qnsc.vn,quangld@qnsc.vn"
   */
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;
