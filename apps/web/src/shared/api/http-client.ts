/**
 * Typed HTTP client — wraps openapi-fetch for the same-origin BFF auth model.
 * All API calls go through here; never call fetch() directly.
 *
 * Auth model: the browser holds NO tokens. Requests carry the
 * `__Host-rally_session` cookie (sent automatically via `credentials: 'include'`),
 * and the API's shared guard resolves + refreshes the underlying access token
 * server-side. A 401 therefore means the session is genuinely dead.
 */
import createClient from 'openapi-fetch'
import type { paths } from './generated/api'
import { ENV } from '@/shared/config/env'

const BASE_URL = ENV.API_BASE_URL

// ── Base client ──────────────────────────────────────────────────────────────
export const apiClient = createClient<paths>({
  baseUrl: BASE_URL,
  credentials: 'include',
})

// ── Request middleware: OTel trace correlation ───────────────────────────────
apiClient.use({
  async onRequest({ request }) {
    // W3C traceparent for OTel correlation. crypto.randomUUID() needs a secure
    // context (HTTPS/localhost) — skip in plain-HTTP dev.
    if (typeof crypto.randomUUID === 'function') {
      const traceId = crypto.randomUUID().replace(/-/g, '')
      const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      request.headers.set('traceparent', `00-${traceId}-${spanId}-01`)
    }
    return request
  },

  // ── Response middleware: 401 → login; 403 → forbidden ──────────────────────
  async onResponse({ request, response }) {
    if (response.status === 401) {
      // The shared guard refreshes the session's access token server-side, so a
      // 401 means the session is truly dead — send the user to login, keeping
      // the current page as returnTo.
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?returnTo=${returnTo}`
    }

    // 403: access-denied page (unless an auth endpoint where the caller handles
    // the error inline, e.g. the login form).
    if (response.status === 403 && !request.url.includes('/auth/')) {
      window.location.href = '/403'
    }

    return response
  },
})
