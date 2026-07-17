/**
 * Auth bootstrap — runs once on app start (or page refresh). Restores the
 * session from the same-origin `__Host-rally_session` cookie via the
 * cookie-authenticated /v1/bff/me. There are no in-browser tokens; the shared
 * guard refreshes the underlying access token server-side. Must be awaited
 * before the router guard evaluates `isAuthenticated`.
 */
import { ENV } from '@/shared/config/env'
import { useAuthStore } from '@/shared/lib/stores/auth.store'

const BASE = ENV.API_BASE_URL

let _bootstrapPromise: Promise<void> | null = null

export function bootstrapAuth(): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise
  _bootstrapPromise = _run()
  return _bootstrapPromise
}

async function _run(): Promise<void> {
  const { clearAuth, setLoading, setUser } = useAuthStore.getState()
  setLoading(true)
  try {
    const meRes = await fetch(`${BASE}/v1/bff/me`, {
      credentials: 'include',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
    })

    if (!meRes.ok) {
      clearAuth()
      return
    }

    const user = (await meRes.json()) as MeResponse
    setUser(
      {
        ...user,
        permissions: user.permissions ?? [],
        locale: user.locale ?? 'en',
        timezone: user.timezone ?? 'UTC',
        emailVerified: user.emailVerified ?? false,
        createdAt: user.createdAt ?? '',
        updatedAt: user.updatedAt ?? '',
      },
      user.memberships ?? [],
    )
  } catch {
    clearAuth()
  }
}

interface MeResponse {
  id: string
  email: string
  displayName: string
  avatarUrl?: string | null
  locale: string
  timezone: string
  phone?: string | null
  role: string
  permissions: string[]
  emailVerified: boolean
  createdAt: string
  updatedAt: string
  memberships: {
    workspaceId: string
    name: string
    slug: string
    lastActiveAt: string | null
    roleSlug: string | null
    roleName: string | null
  }[]
}
