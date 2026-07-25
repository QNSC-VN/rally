import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Algorithm } from 'jsonwebtoken';
import type { JwtPayload as CoreJwtPayload } from '@qnsc-vn/identity';
import { AppConfigService } from '../config/app-config.service';
import { toRallyPrincipal } from './rally-principal';

/**
 * Rally's request-scoped auth principal. Extends the shared `@qnsc-vn/identity`
 * access-token payload — which carries the product-neutral `contextId` and the
 * product-defined `claims` bag — with rally's own flattened conveniences:
 * `workspaceId` (== `contextId`) and `permissions` (== `claims.permissions`).
 * Keeping these mirrors means rally's guards, decorators, and controllers keep
 * reading the same `req.user` fields they always have.
 */
export interface JwtPayload extends CoreJwtPayload {
  /** Active workspace id — rally's mirror of the core `contextId`. */
  workspaceId: string;
  /**
   * Effective permission codes for this user — rally's flattened mirror of
   * `claims.permissions`. Embedded at token-mint time and refreshed on every
   * rotation, so stale permissions are bounded by the access-token TTL.
   */
  permissions: string[];
  /**
   * The authorization epoch the above `permissions` were resolved at — rally's
   * flattened mirror of `claims.authzEpoch`. {@link JwtAuthGuard} compares it
   * against the live epoch so a permission change invalidates this snapshot on
   * the next request instead of at token expiry. `0` on tokens minted before the
   * epoch existed.
   *
   * Optional because it is genuinely absent from tokens minted before this claim
   * shipped (and from synthetic principals in tests); a missing value is read as
   * `0`, i.e. "older than any bump".
   */
  authzEpoch?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_PUBLIC_KEY'),
      algorithms: ['ES256'] as Algorithm[],
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
    });
  }

  /**
   * Map the verified `@qnsc-vn/identity` token onto rally's `req.user`:
   * `contextId` → `workspaceId` and `claims.permissions` → `permissions`.
   * The denylist (Valkey) check happens in the JwtAuthGuard.
   */
  validate(payload: CoreJwtPayload): JwtPayload {
    return toRallyPrincipal(payload);
  }
}
