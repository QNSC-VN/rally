/**
 * Auth bootstrap — runs once on app start (or page refresh).
 * Attempts to restore the session from the httpOnly refresh-token cookie.
 * If the cookie is absent/expired and SSO is configured, checks for an
 * in-progress MSAL redirect (i.e., returning from Microsoft account picker).
 * Must be awaited before the router guard evaluates `isAuthenticated`.
 */
import { ENV, isSsoConfigured } from '@/shared/config/env'
import { setAccessToken, scheduleProactiveRefresh } from '@/shared/api/http-client'
import { useAuthStore } from '@/shared/lib/stores/auth.store'

const BASE = ENV.API_BASE_URL

let _bootstrapPromise: Promise<void> | null = null

export function bootstrapAuth(): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise
  _bootstrapPromise = _run()
  return _bootstrapPromise
}

async function _run(): Promise<void> {
  const { clearAuth, setLoading } = useAuthStore.getState()
  setLoading(true)
  try {
    // ── Step 1: Try to restore session from httpOnly refresh-token cookie ─────
    const refreshRes = await fetch(`${BASE}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      referrerPolicy: 'no-referrer',
    })

    if (refreshRes.ok) {
      const { accessToken, expiresIn } = (await refreshRes.json()) as {
        accessToken: string
        expiresIn?: number
      }
      await _finalizeSession(accessToken, expiresIn)
      return
    }

    // ── Step 2: Check for in-progress MSAL redirect (SSO) ────────────────────
    if (isSsoConfigured) {
      // eslint-disable-next-line boundaries/dependencies
      const { handleSsoRedirect } = await import('@/app/auth/msal')
      const result = await handleSsoRedirect()

      if (result?.idToken) {
        const ssoRes = await fetch(`${BASE}/v1/auth/sso`, {
          method: 'POST',
          credentials: 'include',
          referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: result.idToken }),
        })

        if (ssoRes.ok) {
          const { accessToken, expiresIn } = (await ssoRes.json()) as {
            accessToken: string
            expiresIn?: number
          }
          await _finalizeSession(accessToken, expiresIn)
          return
        }
      }
    }

    clearAuth()
  } catch {
    clearAuth()
  }
}

async function _finalizeSession(accessToken: string, expiresIn?: number): Promise<void> {
  const { setUser, clearAuth } = useAuthStore.getState()
  setAccessToken(accessToken)
  if (expiresIn) scheduleProactiveRefresh(expiresIn)

  const meRes = await fetch(`${BASE}/v1/auth/me`, {
    credentials: 'include',
    referrerPolicy: 'no-referrer',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!meRes.ok) {
    clearAuth()
    return
  }

  const user = (await meRes.json()) as {
    id: string
    email: string
    displayName: string
    avatarUrl?: string | null
    locale: string
    timezone: string
    role: string
    permissions: string[]
    emailVerified: boolean
    createdAt: string
    updatedAt: string
    memberships: {
      tenantId: string
      tenantName: string
      tenantSlug: string
      lastActiveAt: string | null
      roleSlug: string | null
      roleName: string | null
    }[]
  }

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
    accessToken,
    user.memberships ?? [],
  )
}
