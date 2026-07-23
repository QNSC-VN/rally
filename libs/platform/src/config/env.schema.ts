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
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    /** Set to 'true' in local dev / CI to bypass all rate limiting. Never set in production. */
    DISABLE_RATE_LIMIT: booleanish(false),

    // ── Database ───────────────────────────────────────────────────────────────
    // Supply EITHER a complete DATABASE_URL (local dev, CI) OR the discrete parts
    // (deployed). See db/database-url.ts for why the deployed path composes from
    // parts rather than storing a URL: the password belongs to the RDS-managed
    // secret that AWS rotates, and any copy of it goes stale silently.
    DATABASE_URL: z.string().url().optional(),
    DATABASE_HOST: z.string().optional(),
    DATABASE_PORT: z.coerce.number().int().positive().optional(),
    DATABASE_NAME: z.string().optional(),
    DATABASE_USER: z.string().optional(),
    DATABASE_PASSWORD: z.string().optional(),
    DATABASE_SSLMODE: z.string().default('require'),

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
    /**
     * Custom AWS service endpoint. Set ONLY in local dev / CI to target an
     * emulator such as LocalStack (e.g. http://localhost:4566). Leave UNSET in
     * real AWS environments so the SDK uses the default regional endpoints.
     */
    AWS_ENDPOINT_URL: z.string().url().optional(),
    /**
     * Static AWS credentials. Set ONLY alongside AWS_ENDPOINT_URL for local dev /
     * CI (LocalStack accepts any value, conventionally "test"). In real AWS the
     * ECS task role / instance profile supplies credentials — leave these UNSET.
     */
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    SNS_TOPIC_ARN: z.string().optional(),
    SQS_AUDIT_URL: z.string().optional(),
    SQS_REPORTING_URL: z.string().optional(),
    SQS_SEARCH_URL: z.string().optional(),
    /** PRIVATE bucket — every permission-gated upload. Served only via presigned GET. */
    S3_ATTACHMENTS_BUCKET: z.string().default('rally-attachments'),

    /**
     * PUBLIC bucket — non-sensitive assets only (avatars, workspace logos). World-
     * readable by key. Optional: when unset, any attempt to store a public asset
     * throws rather than silently falling back to the private bucket.
     */
    S3_PUBLIC_ASSETS_BUCKET: z.string().optional(),

    /**
     * CDN origin for the PUBLIC bucket. MUST NOT point at the private bucket —
     * doing so makes every attachment readable by key, bypassing authorization
     * entirely. StorageService.cdnUrl() has no private-bucket path for this reason.
     */
    CDN_PUBLIC_ASSETS_BASE_URL: z.string().url().optional(),

    // Object-storage backend selection (provider-neutral). All optional:
    //  - unset          → AWS S3 via the default credential chain (ECS task role).
    //  - STORAGE_ENDPOINT set → S3-compatible backend (Cloudflare R2, MinIO).
    // R2 requires STORAGE_ENDPOINT + STORAGE_ACCESS_KEY_ID + STORAGE_SECRET_ACCESS_KEY
    // + STORAGE_FORCE_PATH_STYLE=true. Bucket names stay S3_ATTACHMENTS_BUCKET /
    // S3_PUBLIC_ASSETS_BUCKET — both buckets share one endpoint and credential pair.
    STORAGE_ENDPOINT: z.string().url().optional(),
    STORAGE_ACCESS_KEY_ID: z.string().optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
    STORAGE_FORCE_PATH_STYLE: booleanish(false),

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
     * Multi-IdP broker: the single app-level OIDC callback shared by every
     * federated connection (the same `/bff/callback` endpoint). Defaults to
     * ENTRA_REDIRECT_URI when unset (the home connection reuses it).
     */
    IDENTITY_REDIRECT_URI: z.string().url().optional(),
    /**
     * Multi-IdP broker: Secrets Manager ref (name/ARN, e.g. `rally/${env}/sso/home`)
     * holding the HOME Entra client secret for the broker path. When unset the home
     * connection is seeded without a secret ref and only the legacy home flow works.
     */
    IDENTITY_HOME_SECRET_REF: z.string().optional(),
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
  })
  .superRefine((env, ctx) => {
    // Database credentials must arrive by exactly one of the two routes. Checked
    // here so a misconfigured task dies at boot with a precise message, rather
    // than surviving startup and failing on the first query — which is how the
    // stale db-url secret presented: a healthy-looking deploy, then 28P01.
    if (env.DATABASE_URL) return;

    const missing = (
      [
        'DATABASE_HOST',
        'DATABASE_PORT',
        'DATABASE_NAME',
        'DATABASE_USER',
        'DATABASE_PASSWORD',
      ] as const
    ).filter((k) => !env[k]);

    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message:
          `Database not configured. Set DATABASE_URL, or all of DATABASE_HOST, DATABASE_PORT, ` +
          `DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD. Missing: ${missing.join(', ')}.`,
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;
