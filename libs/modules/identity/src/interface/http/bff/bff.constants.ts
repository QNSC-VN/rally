/**
 * The opaque BFF session-id cookie name is owned by the platform auth layer,
 * because the shared `JwtAuthGuard` reads it. Re-exported here so BFF code has a
 * single import site for all its cookie names.
 */
export { BFF_SESSION_COOKIE } from '@platform';

/**
 * Short-lived OIDC `state` cookie, browser-bound for the login round-trip.
 * `SameSite=Lax` (not Strict) so it survives the top-level redirect back from
 * Entra; `__Host-` keeps it Secure and origin-locked.
 */
export const BFF_STATE_COOKIE = '__Host-bff_state';

/** Lifetime of the state cookie — matches the auth-request TTL (10 minutes). */
export const BFF_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
