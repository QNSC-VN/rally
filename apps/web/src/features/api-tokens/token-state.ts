/**
 * What state a token is in, derived rather than stored.
 *
 * The API returns `expiresAt` and `revokedAt` and no status field, which is right — a status column
 * would be a second source of truth that a clock can invalidate. So the derivation lives here, as
 * one pure function, tested directly: every surface that shows a token asks the same question and
 * gets the same answer.
 *
 * `expiring` exists because it is the state a human can still act on. An expired token is a support
 * ticket that has already happened; a token expiring on Friday is a task, and it is only a task if
 * something says so before Friday.
 */
import type { ApiToken } from './api'

export type TokenState = 'active' | 'expiring' | 'expired' | 'revoked'

/** Inside this window, an active token is reported as `expiring`. */
export const EXPIRING_SOON_DAYS = 14

export function tokenState(token: ApiToken, now: Date = new Date()): TokenState {
  if (token.revokedAt) return 'revoked'
  const expiresAt = new Date(token.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) {
    // An unparseable date is not an assertion that the token is fine. Reported as expired, which is
    // the reading that makes someone look, rather than `active`, which makes them stop looking.
    return 'expired'
  }
  if (expiresAt <= now.getTime()) return 'expired'
  return expiresAt - now.getTime() <= EXPIRING_SOON_DAYS * 86_400_000 ? 'expiring' : 'active'
}

/**
 * Whole days until expiry, floored, negative once past. Returned rather than formatted so the
 * caller owns the copy and its pluralisation (i18n counts, not string concatenation).
 */
export function daysUntilExpiry(token: ApiToken, now: Date = new Date()): number {
  const expiresAt = new Date(token.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) return 0
  return Math.floor((expiresAt - now.getTime()) / 86_400_000)
}

/** Whether revoking is still meaningful. A revoked or expired token needs no action. */
export function isRevocable(token: ApiToken, now: Date = new Date()): boolean {
  const state = tokenState(token, now)
  return state === 'active' || state === 'expiring'
}
