/**
 * Opaque BFF session id cookie. The `__Host-` prefix pins it to Secure +
 * path=/ + no Domain, so a subdomain can neither set nor read it. `SameSite=Strict`
 * because the SPA and API are same-origin under the BFF, so no cross-site GET
 * ever needs to carry it.
 */
export const BFF_SESSION_COOKIE = '__Host-rally_session';

/**
 * Short-lived OIDC `state` cookie, browser-bound for the login round-trip.
 * `SameSite=Lax` (not Strict) so it survives the top-level redirect back from
 * Entra; `__Host-` keeps it Secure and origin-locked.
 */
export const BFF_STATE_COOKIE = '__Host-bff_state';

/** Lifetime of the state cookie — matches the auth-request TTL (10 minutes). */
export const BFF_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
