/**
 * MSAL (Microsoft Authentication Library) singleton for Microsoft Entra ID SSO.
 *
 * This module lazily initialises the MSAL PublicClientApplication.
 * It is safe to import at the module level — MSAL won't make network calls
 * until `initialize()` or `loginRedirect()` is invoked.
 *
 * Usage:
 *   import { triggerSsoLogin, handleSsoRedirect } from '@/app/auth/msal'
 */
import {
  PublicClientApplication,
  type AuthenticationResult,
  type AccountInfo,
  InteractionRequiredAuthError,
} from '@azure/msal-browser'
import { ENV } from '@/shared/config/env'

// ── Configuration ────────────────────────────────────────────────────────────

const msalConfig = {
  auth: {
    clientId: ENV.ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${ENV.ENTRA_TENANT_ID}`,
    redirectUri: window.location.origin,
  },
  cache: {
    // sessionStorage: cleared when browser tab is closed.
    // Do NOT use localStorage — Entra tokens should not persist across sessions.
    cacheLocation: 'sessionStorage' as const,
    storeAuthStateInCookie: false,
  },
  system: {
    // Suppress MSAL's verbose console output in production
    loggerOptions: {
      logLevel: ENV.IS_DEV ? 3 : 0, // 3 = Verbose, 0 = Error
    },
  },
}

let _instance: PublicClientApplication | null = null
let _initPromise: Promise<void> | null = null

function getInstance(): PublicClientApplication {
  if (!_instance) {
    _instance = new PublicClientApplication(msalConfig)
  }
  return _instance
}

async function ensureInitialized(): Promise<PublicClientApplication> {
  const instance = getInstance()
  if (!_initPromise) {
    _initPromise = instance.initialize()
  }
  await _initPromise
  return instance
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Starts the Microsoft account-picker login flow.
 * Redirects the browser — the page will reload after authentication.
 * Call `handleSsoRedirect()` on app boot to complete the flow.
 */
export async function triggerSsoLogin(): Promise<void> {
  const instance = await ensureInitialized()
  // Clear any stale interaction state from a previous abandoned redirect.
  // MSAL throws interaction_in_progress if a prior loginRedirect was never completed.
  // navigateToLoginRequestUrl:false keeps the app at redirectUri after the redirect
  // so bootstrapAuth() can call handleRedirectPromise() before routing fires.
  await instance.handleRedirectPromise({ navigateToLoginRequestUrl: false }).catch(() => null)
  await instance.loginRedirect({
    scopes: ['openid', 'profile', 'email'],
    // Always show the Microsoft account picker (matches the enterprise UX pattern)
    prompt: 'select_account',
  })
}

/**
 * Must be called once on every app boot (before the router runs).
 * Returns the AuthenticationResult if we are returning from a redirect login,
 * or null if this is a normal page load.
 */
export async function handleSsoRedirect(): Promise<AuthenticationResult | null> {
  const instance = await ensureInitialized()
  try {
    // navigateToLoginRequestUrl:false keeps the app at redirectUri (/) instead of
    // navigating back to the originating page (/login) before processing the code.
    // In MSAL v5 this is a per-call option, not a global config setting.
    return await instance.handleRedirectPromise({ navigateToLoginRequestUrl: false })
  } catch {
    // Redirect errors are non-fatal — user may have cancelled or navigated away
    return null
  }
}

/**
 * Attempt a silent token refresh for the active account.
 * Returns the idToken string, or null if no active session.
 *
 * @deprecated Use tryAcquireSsoTokenSilent for enterprise refresh flows —
 * this version auto-redirects on InteractionRequiredAuthError, which is
 * unsafe to call from background refresh middleware.
 */
export async function acquireSsoTokenSilent(): Promise<string | null> {
  const instance = await ensureInitialized()
  const accounts = instance.getAllAccounts()
  if (accounts.length === 0) return null

  try {
    const result = await instance.acquireTokenSilent({
      scopes: ['openid', 'profile', 'email'],
      account: accounts[0] as AccountInfo,
    })
    return result.idToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      // Token expired and silent refresh failed — trigger interactive login
      await triggerSsoLogin()
    }
    return null
  }
}

/**
 * Enterprise SSO silent token refresh — structured result, NO auto-redirect.
 *
 * Returns:
 *  - `{ idToken: string }` — fresh Entra id_token; exchange with POST /auth/sso
 *  - `'interaction_required'` — Entra session revoked; caller MUST force re-login
 *  - `null` — no MSAL accounts in sessionStorage (new tab / password user)
 *
 * Callers in the refresh middleware must handle 'interaction_required' by
 * clearing the Rally session and redirecting to /login. Do NOT fall back to
 * /auth/refresh in that case — the Entra session is deliberately revoked.
 */
export async function tryAcquireSsoTokenSilent(): Promise<
  { idToken: string } | 'interaction_required' | null
> {
  const instance = await ensureInitialized()
  const accounts = instance.getAllAccounts()
  if (accounts.length === 0) return null

  try {
    const result = await instance.acquireTokenSilent({
      scopes: ['openid', 'profile', 'email'],
      account: accounts[0] as AccountInfo,
    })
    return { idToken: result.idToken }
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      return 'interaction_required'
    }
    // Network error, timeout, etc. — treat as transient; caller falls back
    return null
  }
}

/**
 * Perform a full Microsoft sign-out redirect.
 * The browser navigates to Microsoft's logout endpoint, then returns to
 * `postLogoutUri`. Use this instead of `clearSsoSession` when you want
 * to also invalidate the Microsoft session (enterprise sign-out requirement).
 */
export async function msalLogoutRedirect(postLogoutUri: string): Promise<void> {
  const instance = await ensureInitialized()
  await instance.logoutRedirect({ postLogoutRedirectUri: postLogoutUri })
}

/**
 * Clear the MSAL session state (called on logout so the next login shows
 * the account picker rather than silently re-logging in).
 */
export async function clearSsoSession(): Promise<void> {
  const instance = await ensureInitialized()
  const accounts = instance.getAllAccounts()
  if (accounts.length > 0) {
    // logoutRedirect would redirect to Microsoft — we skip that and just clear
    // the local MSAL cache so the next triggerSsoLogin() shows the picker.
    for (const account of accounts) {
      await instance.clearCache({ correlationId: undefined }).catch(() => null)
      instance.setActiveAccount(null)
      // Remove the specific account
      try {
        await instance.logoutPopup({ account }).catch(() => null)
      } catch {
        // Popup may be blocked — silently ignore
      }
    }
  }
}
