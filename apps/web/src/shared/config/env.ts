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

  // Auth mode — 'legacy' (MSAL in-browser SSO, default) or 'bff' (same-origin
  // Backend-for-Frontend: login/session handled server-side, session cookie only).
  // Flip to 'bff' per-deployment via VITE_AUTH_MODE once the edge proxy is live.
  AUTH_MODE: (import.meta.env.VITE_AUTH_MODE ?? 'legacy') as 'legacy' | 'bff',

  // Passwordless dev-login affordance (seeded accounts, no Entra). OFF by
  // default so it never ships to production; enable per NON-PROD deployment via
  // VITE_DEV_LOGIN=true so QA can sign in the same way in every environment. The
  // API independently hard-blocks dev-login when NODE_ENV==='production'.
  DEV_LOGIN_ENABLED: (import.meta.env.VITE_DEV_LOGIN ?? 'false') === 'true',

  // SSO — Microsoft Entra ID
  // Set these in .env.local (or CI/CD secrets) to enable SSO login.
  ENTRA_TENANT_ID: (import.meta.env.VITE_ENTRA_TENANT_ID ?? '') as string,
  ENTRA_CLIENT_ID: (import.meta.env.VITE_ENTRA_CLIENT_ID ?? '') as string,
} as const

/** True when the SPA uses the same-origin BFF auth flow instead of in-browser MSAL. */
export const isBffAuth = ENV.AUTH_MODE === 'bff'

/** True when Microsoft Entra SSO is configured for this deployment. */
export const isSsoConfigured = !!(ENV.ENTRA_TENANT_ID && ENV.ENTRA_CLIENT_ID)
