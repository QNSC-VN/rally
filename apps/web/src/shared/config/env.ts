/**
 * Centralised environment configuration.
 * All `import.meta.env.*` access should go through here — never inline env reads.
 */
export const ENV = {
  // Empty string → relative URLs; works in dev (Vite proxy handles /v1) and prod (CloudFront proxy handles /v1).
  API_BASE_URL: import.meta.env.VITE_API_URL ?? '',
  APP_ENV: (import.meta.env.VITE_APP_ENV ?? 'development') as
    'development' | 'staging' | 'production',
  IS_DEV: import.meta.env.DEV,

  // Passwordless dev-login affordance (seeded accounts, no Entra). OFF by
  // default so it never ships to production; enable per NON-PROD deployment via
  // VITE_DEV_LOGIN=true so QA can sign in the same way in every environment. The
  // API independently hard-blocks dev-login when NODE_ENV==='production'.
  DEV_LOGIN_ENABLED: (import.meta.env.VITE_DEV_LOGIN ?? 'false') === 'true',
} as const
