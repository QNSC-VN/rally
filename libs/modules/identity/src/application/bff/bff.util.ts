import type { JwtPayload } from '@platform';
import type { JwtPayload as CoreJwtPayload } from '@qnsc-vn/identity';

/**
 * Open-redirect guard for the post-login `returnTo`.
 *
 * The browser controls this value, so we only ever honour a *root-relative*
 * same-origin path. Anything that could send the user off-origin after a
 * successful login — absolute URLs, protocol-relative `//evil.com`, or
 * backslash tricks that some browsers normalise to `/` — is rejected and the
 * caller falls back to the configured default.
 */
export function isSafeReturnTo(value: string | undefined | null): value is string {
  if (!value) return false;
  if (!value.startsWith('/')) return false; // must be root-relative
  if (value.startsWith('//')) return false; // protocol-relative → off-origin
  if (value.includes('\\')) return false; // backslash → browser may treat as //
  return true;
}

/**
 * Read a single cookie value from a Fastify request.
 *
 * `@fastify/cookie` populates `req.cookies`; this helper narrows the loosely
 * typed bag without pulling the plugin's ambient types into non-controller code.
 */
export function readCookie(
  req: { cookies?: Record<string, string | undefined> },
  name: string,
): string | undefined {
  const cookies = req.cookies;
  return cookies && typeof cookies === 'object' ? cookies[name] : undefined;
}

/**
 * Decode a rally-issued access token into the request principal, replicating
 * {@link JwtStrategy.validate}'s mapping (`contextId → workspaceId`,
 * `claims.permissions → permissions`).
 *
 * No signature verification is performed: the token is one this backend just
 * minted and loaded from its own trusted server-side session store, so this is
 * a decode, not a trust decision. Callers must never feed browser-supplied
 * tokens here.
 */
export function decodeAccessTokenClaims(accessToken: string): JwtPayload {
  const segment = accessToken.split('.')[1];
  if (!segment) {
    throw new Error('BFF: malformed access token (missing payload segment)');
  }
  const json = Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  );
  const payload = JSON.parse(json) as CoreJwtPayload;

  const rawPermissions = (payload.claims as { permissions?: unknown } | undefined)?.permissions;
  const permissions = Array.isArray(rawPermissions) ? (rawPermissions as string[]) : [];

  return { ...payload, workspaceId: payload.contextId ?? '', permissions };
}
