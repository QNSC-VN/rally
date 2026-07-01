/**
 * Centralised environment configuration.
 * All `import.meta.env.*` access should go through here — never inline env reads.
 */
export const ENV = {
  API_BASE_URL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  APP_ENV: (import.meta.env.VITE_APP_ENV ?? 'development') as 'development' | 'staging' | 'production',
  IS_DEV: import.meta.env.DEV,

  // SSO — Microsoft Entra ID
  // Set these in .env.local (or CI/CD secrets) to enable SSO login.
  ENTRA_TENANT_ID: (import.meta.env.VITE_ENTRA_TENANT_ID ?? '') as string,
  ENTRA_CLIENT_ID: (import.meta.env.VITE_ENTRA_CLIENT_ID ?? '') as string,
} as const

/** True when Microsoft Entra SSO is configured for this deployment. */
export const isSsoConfigured = !!(ENV.ENTRA_TENANT_ID && ENV.ENTRA_CLIENT_ID)
