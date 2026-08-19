import type { JwtPayload } from './jwt.strategy';

/**
 * Optional bridge that lets the shared {@link JwtAuthGuard} authenticate a request from an opaque,
 * long-lived API token instead of a JWT.
 *
 * Same inversion as {@link BffSessionResolver}, for the same reason: the concrete implementation
 * (database lookup, hash comparison, expiry and revocation) lives in the product's api-tokens module,
 * and the platform layer keeps no dependency on it. Left unbound — any product without machine
 * credentials — the guard behaves exactly as before, so the JWT and BFF paths are byte-for-byte
 * unchanged.
 *
 * WHY A SEPARATE SEAM RATHER THAN A JWT WITH A LONG EXPIRY. A signed token cannot be revoked without a
 * denylist entry per token, and it carries its claims from mint time — which is the snapshot problem
 * this codebase already removed once. An opaque token is a database lookup on every request, so
 * revocation is a row update and the principal's permissions are always read fresh.
 */
export interface ApiTokenResolver {
  /** Whether API-token auth is active. When false the guard skips this path entirely. */
  readonly enabled: boolean;
  /**
   * Resolve the request principal for a raw token, or `null` when the token is unknown, expired or
   * revoked. Implementations must not throw for a bad token — an authentication failure is a normal
   * outcome and the guard turns `null` into 401.
   */
  resolve(rawToken: string, ip: string): Promise<ApiTokenPrincipal | null>;
}

/**
 * A principal authenticated by an API token.
 *
 * Deliberately shaped as a {@link JwtPayload} so every downstream consumer — request context,
 * `@CurrentUser()`, the audit trail, `PolicyGuard` — is path-agnostic and needs no branch. The two
 * extra fields are what a token adds beyond identity:
 *
 * - `apiTokenId` identifies the credential, so the audit trail can name it and privileged routes can
 *   refuse a token-authenticated caller.
 * - `scopes` NARROWS authorization. `PolicyGuard` intersects it with the permissions it resolves from
 *   the database; an empty or absent array means no narrowing. Permissions are still never read FROM
 *   the token — this array can only subtract, so a token can never exceed its owner.
 */
export interface ApiTokenPrincipal extends JwtPayload {
  readonly apiTokenId: string;
  readonly scopes?: readonly string[];
}

/** DI token for the optional {@link ApiTokenResolver}. */
export const API_TOKEN_RESOLVER = Symbol('API_TOKEN_RESOLVER');

/**
 * Prefix every API token carries.
 *
 * Load-bearing in three places: the guard tells an opaque token from a JWT by it (a JWT is three
 * base64url segments separated by dots and can never start with this), secret scanners key on it, and
 * a leaked string in a log or a commit is identifiable at a glance as a Rally credential. Shared here
 * so the minting service and the guard cannot disagree about it.
 */
export const API_TOKEN_PREFIX = 'rly_';

/** True when a Bearer value is an API token rather than a JWT. */
export function isApiTokenValue(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX);
}
