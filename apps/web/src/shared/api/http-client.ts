/**
 * Typed HTTP client — wraps openapi-fetch with auth, CSRF, refresh, and trace.
 * All API calls go through here; never call fetch() directly.
 *
 * Auth model (FRONTEND_STRUCTURE §8):
 *  - Access JWT: in-memory only (never localStorage)
 *  - Refresh token: httpOnly cookie (auto-sent by browser)
 *  - CSRF token: double-submit cookie+header on mutating requests
 */
import createClient from 'openapi-fetch'
import type { paths } from './generated/api'
import { ENV } from '@/shared/config/env'
import { getSsoRefresh } from './sso-refresh-slot'

const BASE_URL = ENV.API_BASE_URL

// ── In-memory access token (never stored in localStorage) ────────────────────
let _accessToken: string | null = null

export function setAccessToken(token: string | null) {
  _accessToken = token
}

export function getAccessToken() {
  return _accessToken
}

// ── Proactive refresh timer — fires 60s before access token expires ───────────
// This avoids the 401 → refresh → retry latency hit that would otherwise occur
// on the first request after every 15-minute expiry window.
let _refreshTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleProactiveRefresh(expiresIn: number) {
  cancelProactiveRefresh()
  const delayMs = Math.max((expiresIn - 60) * 1000, 30_000) // at least 30s
  _refreshTimer = setTimeout(() => void refreshAccessToken(), delayMs)
}

export function cancelProactiveRefresh() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer)
    _refreshTimer = null
  }
}

// ── CSRF token (read from cookie, sent as header) ────────────────────────────
function getCsrfToken(): string | undefined {
  return document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csrf-token='))
    ?.split('=')[1]
}

// ── Single-flight refresh (prevents concurrent 401s triggering multiple refreshes)
let _refreshPromise: Promise<boolean> | null = null

/**
 * Decode authMethod from the in-memory access token without verifying the
 * signature (the server already verified it; we just need the claim locally).
 */
function getAuthMethodFromToken(): 'sso' | 'password' | null {
  if (!_accessToken) return null
  try {
    const payload = JSON.parse(atob(_accessToken.split('.')[1]!)) as {
      authMethod?: string
    }
    return payload.authMethod === 'sso' ? 'sso' : 'password'
  } catch {
    return null
  }
}

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = (async () => {
    try {
      // Enterprise SSO path: re-validate with Microsoft Entra on every refresh
      // cycle. This enforces Entra deprovisioning within one access-token TTL
      // (default 15 min) rather than the full 30-day Rally refresh window.
      const ssoFn = getSsoRefresh()
      if (getAuthMethodFromToken() === 'sso' && ssoFn) {
        const ssoResult = await ssoFn()

        if (ssoResult === 'interaction_required') {
          // Entra deliberately revoked the session (user deprovisioned, MFA
          // policy change, conditional-access block). Do NOT fall back to
          // Rally refresh — the session must be invalidated immediately.
          setAccessToken(null)
          return false
        }

        if (ssoResult !== null) {
          // Fresh Entra id_token — exchange for a new Rally session
          const res = await fetch(`${BASE_URL}/v1/auth/sso`, {
            method: 'POST',
            credentials: 'include',
            referrerPolicy: 'no-referrer',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: ssoResult.idToken }),
          })
          if (!res.ok) return false
          const data = (await res.json()) as { accessToken: string; expiresIn?: number }
          setAccessToken(data.accessToken)
          if (data.expiresIn) scheduleProactiveRefresh(data.expiresIn)
          return true
        }
        // ssoResult === null: no MSAL accounts in sessionStorage (new tab or
        // MSAL cache cleared). Fall through to Rally cookie refresh so the
        // user isn't unexpectedly logged out just for opening a new tab.
      }

      // Standard Rally refresh token rotation (password sessions + new-tab SSO fallback)
      const res = await fetch(`${BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) return false
      const data = (await res.json()) as { accessToken: string; expiresIn?: number }
      setAccessToken(data.accessToken)
      if (data.expiresIn) scheduleProactiveRefresh(data.expiresIn)
      return true
    } catch {
      return false
    } finally {
      _refreshPromise = null
    }
  })()
  return _refreshPromise
}

// ── Base client ──────────────────────────────────────────────────────────────
export const apiClient = createClient<paths>({
  baseUrl: BASE_URL,
  credentials: 'include',
})

// ── Request middleware: inject auth + CSRF + trace headers ───────────────────
apiClient.use({
  async onRequest({ request }) {
    if (_accessToken) {
      request.headers.set('Authorization', `Bearer ${_accessToken}`)
    }

    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    if (isMutation) {
      const csrf = getCsrfToken()
      if (csrf) request.headers.set('x-csrf-token', csrf)
    }

    // OTel trace correlation (W3C traceparent)
    // crypto.randomUUID() requires a secure context (HTTPS/localhost) — skip in plain-HTTP dev
    if (typeof crypto.randomUUID === 'function') {
      const traceId = crypto.randomUUID().replace(/-/g, '')
      const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      request.headers.set('traceparent', `00-${traceId}-${spanId}-01`)
    }

    return request
  },

  // ── Response middleware: handle 401 → refresh → retry; 403 → forbidden ──────
  async onResponse({ request, response }) {
    if (response.status === 401 && !request.url.includes('/auth/refresh')) {
      const refreshed = await refreshAccessToken()
      if (refreshed && _accessToken) {
        request.headers.set('Authorization', `Bearer ${_accessToken}`)
        return fetch(request)
      }
      // Refresh failed — redirect to login, preserving the current page as returnTo
      setAccessToken(null)
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?returnTo=${returnTo}`
    }

    // 403: navigate to the access-denied page (unless this is an auth endpoint
    // where the caller handles the error inline, e.g. login form)
    if (response.status === 403 && !request.url.includes('/auth/')) {
      window.location.href = '/403'
    }

    return response
  },
})
