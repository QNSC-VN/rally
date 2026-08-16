import type { JwtPayload as CoreJwtPayload } from '@qnsc-vn/identity';
import type { JwtPayload } from './jwt.strategy';

/**
 * Project the product-neutral `@qnsc-vn/identity` access-token payload onto
 * rally's request principal, adding the flattened conveniences rally's guards,
 * decorators, and controllers read: `workspaceId` (== `contextId`) and
 * `permissions` (== `claims.permissions`).
 *
 * Single source of truth for the mapping, shared by the Bearer path
 * ({@link JwtStrategy.validate}) and the BFF session path (the resolver adapter
 * bound to `BFF_SESSION_RESOLVER`), so both always produce an identical
 * `req.user`.
 */
export function toRallyPrincipal(payload: CoreJwtPayload): JwtPayload {
  const claims = payload.claims as { permissions?: unknown };
  const permissions = Array.isArray(claims.permissions) ? (claims.permissions as string[]) : [];
  return { ...payload, workspaceId: payload.contextId ?? '', permissions };
}
