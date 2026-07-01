/**
 * SSO refresh slot — decouples shared/api from app/auth/msal.
 *
 * The shared HTTP client cannot import from app/ (boundaries rule).
 * Instead, app/ registers a tryAcquireSsoTokenSilent implementation here
 * at startup, and the HTTP client calls through this slot.
 *
 * Result contract (mirrors tryAcquireSsoTokenSilent):
 *   { idToken: string }    — fresh Entra token; exchange via POST /auth/sso
 *   'interaction_required' — Entra revoked session; caller must force logout
 *   null                   — no MSAL accounts (new tab / password user)
 */
export type SsoTokenResult = { idToken: string } | 'interaction_required' | null
type SsoRefreshFn = () => Promise<SsoTokenResult>

let _fn: SsoRefreshFn | null = null

export function registerSsoRefresh(fn: SsoRefreshFn): void {
  _fn = fn
}

export function getSsoRefresh(): SsoRefreshFn | null {
  return _fn
}
