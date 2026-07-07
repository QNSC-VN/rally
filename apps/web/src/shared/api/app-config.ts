import { useQuery } from '@tanstack/react-query'
import { ENV } from '@/shared/config/env'

/**
 * Public runtime config from the API (GET /config). Tells the SPA whether this
 * is a single-tenant instance (hide signup + org switcher) and whether SSO is
 * available. Public — no auth needed — so it can gate the login/signup screens.
 *
 * Uses a plain fetch (not the typed openapi client) because /config is a
 * platform endpoint outside the generated schema; the shape is small and stable.
 */
export interface AppConfig {
  deploymentMode: 'saas' | 'single'
  signupEnabled: boolean
  ssoEnabled: boolean
}

const FALLBACK: AppConfig = {
  deploymentMode: 'saas',
  signupEnabled: true,
  ssoEnabled: false,
}

export function useAppConfig() {
  return useQuery<AppConfig>({
    queryKey: ['app-config'],
    queryFn: async () => {
      try {
        const res = await fetch(`${ENV.API_BASE_URL}/v1/config`, {
          headers: { accept: 'application/json' },
        })
        if (!res.ok) return FALLBACK
        return (await res.json()) as AppConfig
      } catch {
        return FALLBACK
      }
    },
    // Config is stable for the life of the deployment — cache aggressively.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  })
}
