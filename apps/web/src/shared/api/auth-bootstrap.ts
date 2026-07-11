/**
 * Auth bootstrap — runs once on app start (or page refresh).
 * Attempts to restore the session from the httpOnly refresh-token cookie.
 * If the cookie is absent/expired and SSO is configured, checks for an
 * in-progress MSAL redirect (i.e., returning from Microsoft account picker).
 * Must be awaited before the router guard evaluates `isAuthenticated`.
 */
import { ENV, isBffAuth, isSsoConfigured } from '@/shared/config/env'
import {
  setAccessToken,
  scheduleProactiveRefresh,
  refreshAccessToken,
  getAccessToken,
} from '@/shared/api/http-client'
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
    // ── BFF mode: session lives in the __Host-rally_session cookie ───────────
    // No in-browser tokens and no MSAL. /bff/me is cookie-authenticated and the
    // shared guard transparently refreshes the underlying access token
    // server-side, so the client just asks "who am I?" on boot.
    if (isBffAuth) {
      await _runBff()
      return
    }

    // ── Step 1: Try to restore session from httpOnly refresh-token cookie ─────
    // Delegate to the http-client single-flight refresh instead of issuing our
    // own fetch. The refresh cookie is single-use with rotation + theft
    // detection: if this cold-start refresh and a request-triggered
    // refreshAccessToken() both fire with the same cookie, the server rotates
    // on the first and treats the second as token reuse — revoking the entire
    // token family and forcing a re-login. Sharing one in-flight promise makes
    // that race impossible. On cold start there is no access token yet, so
    // refreshAccessToken() takes the standard Rally cookie-refresh path (it also
    // sends the double-submit x-csrf-token header and schedules proactive
    // refresh internally).
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      const accessToken = getAccessToken()
      if (accessToken) {
        await _finalizeSession(accessToken)
        return
      }
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
  const { clearAuth } = useAuthStore.getState()
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

  _applyUser((await meRes.json()) as MeResponse, accessToken)
}

/**
 * BFF cold-start: restore the session from the __Host-rally_session cookie via
 * the cookie-authenticated /bff/me. There is no in-browser access token — the
 * store is seeded with an empty one and requests authenticate via the cookie.
 */
async function _runBff(): Promise<void> {
  const { clearAuth } = useAuthStore.getState()

  const meRes = await fetch(`${BASE}/v1/bff/me`, {
    credentials: 'include',
    referrerPolicy: 'no-referrer',
    headers: { accept: 'application/json' },
  })

  if (!meRes.ok) {
    clearAuth()
    return
  }

  _applyUser((await meRes.json()) as MeResponse, '')
}

interface MeResponse {
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
    workspaceId: string
    name: string
    slug: string
    lastActiveAt: string | null
    roleSlug: string | null
    roleName: string | null
  }[]
}

function _applyUser(user: MeResponse, accessToken: string): void {
  const { setUser } = useAuthStore.getState()
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
