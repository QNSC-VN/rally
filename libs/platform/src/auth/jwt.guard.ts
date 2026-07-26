import {
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequestContextService } from '../context/request-context';

import { failOpenLog, SecurityMetrics } from '@qnsc-vn/observability';
import { AuthTokenCache } from '@qnsc-vn/identity';
import {
  BFF_SESSION_COOKIE,
  BFF_SESSION_RESOLVER,
  type BffSessionResolver,
} from './bff-session-resolver';
import { AuthzEpochService } from './authz-epoch.service';
import type { JwtPayload } from './jwt.strategy';

/**
 * JWT auth guard.
 * Verifies the Bearer access token, then populates request context with
 * workspaceId / userId / sessionId so downstream scoping works correctly.
 * Also checks the access-token denylist in the cache (set on logout).
 *
 * Staleness: the token's `permissions` are a mint-time snapshot, so the guard
 * additionally compares the token's authorization epoch against the live one
 * (see {@link AuthzEpochService}). A Bearer caller holding a superseded snapshot
 * gets 401 `TOKEN_STALE` and refreshes; a BFF session is re-minted in place so
 * the browser never notices. Without this, a revoked permission stayed effective
 * until the token expired (up to JWT_ACCESS_EXPIRY).
 *
 * BFF (same-origin) mode: when a {@link BffSessionResolver} is bound and no
 * Bearer token is present, the guard instead authenticates from the opaque
 * `__Host-` session cookie — resolving (and transparently refreshing) the
 * server-side session. When the resolver is unbound (a product without BFF),
 * this path is skipped entirely and the Bearer flow is byte-for-byte unchanged.
 *
 * Pair with @Public() decorator to opt-out individual routes.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly ctx: RequestContextService,
    private readonly authCache: AuthTokenCache,
    private readonly authzEpoch: AuthzEpochService,
    private readonly securityMetrics: SecurityMetrics,
    @Optional()
    @Inject(BFF_SESSION_RESOLVER)
    private readonly bffResolver?: BffSessionResolver,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      cookies?: Record<string, string | undefined>;
      ip: string;
      user?: JwtPayload;
      bffSid?: string;
    }>();

    // BFF session path: only when a resolver is bound + enabled, there is no
    // Bearer token (which always takes precedence), and the session cookie is
    // present. Anything else falls through to the unchanged JWT path below.
    if (this.bffResolver?.enabled && !hasBearerToken(req.headers.authorization)) {
      const sid = req.cookies?.[BFF_SESSION_COOKIE];
      if (sid) {
        return this.authenticateFromSession(req, sid);
      }
    }

    let result: boolean;
    try {
      result = await (super.canActivate(context) as Promise<boolean>);
    } catch (err) {
      // Re-throw expected auth failures as-is; convert infra errors to 401 so
      // NestJS never leaks a 500 to unauthenticated callers.
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error({ err }, 'JWT strategy error during canActivate');
      throw new UnauthorizedException('Authentication service unavailable');
    }
    if (!result) return false;

    const user = req.user as JwtPayload;
    await this.enforceDenylist(user.jti, user.sub);

    // Bearer path: the caller owns its token, so the correct response to a
    // superseded snapshot is to make it refresh. `TOKEN_STALE` distinguishes this
    // from an expired or revoked token so the client can refresh silently instead
    // of sending the user back to login.
    if (await this.authzEpoch.isStale(user.sub, user.authzEpoch)) {
      this.logger.log({ userId: user.sub }, 'Access token authz epoch is stale; refresh required');
      throw new UnauthorizedException('TOKEN_STALE');
    }
    return true;
  }

  /**
   * Authenticate a request from a BFF session id: resolve/refresh the session,
   * enforce the same denylist as the Bearer path, then populate `req.user`,
   * `req.bffSid`, and the request context so downstream code is path-agnostic.
   */
  private async authenticateFromSession(
    req: { ip: string; user?: JwtPayload; bffSid?: string },
    sid: string,
  ): Promise<boolean> {
    let claims = await this.bffResolver!.resolve(sid, req.ip);
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    await this.enforceDenylist(claims.jti, claims.sub);
    claims = await this.refreshIfStale(sid, req.ip, claims);

    req.user = claims;
    req.bffSid = sid;
    this.ctx.setAuthContext(claims.workspaceId, claims.sub, claims.sessionId);
    return true;
  }

  /**
   * BFF path staleness handling: when the session's snapshot predates a permission
   * change, re-mint it in place and use the fresh claims for this very request.
   * The session id — and therefore the browser's cookie — is unchanged, so this is
   * invisible to the user.
   *
   * Re-minting happens at most once per request. If the freshly-minted claims are
   * *still* behind (a concurrent bump, or an epoch that cannot be satisfied), the
   * request is rejected rather than retried, so a pathological loop can never mint
   * sessions in a tight cycle.
   */
  private async refreshIfStale(sid: string, ip: string, claims: JwtPayload): Promise<JwtPayload> {
    if (!(await this.authzEpoch.isStale(claims.sub, claims.authzEpoch))) return claims;

    // A product without a re-mint path can only fail closed here: the snapshot is
    // known-stale, so serving it would be the exact bug this check exists to fix.
    if (!this.bffResolver?.remint) {
      this.logger.warn(
        { userId: claims.sub },
        'BFF session authz epoch is stale and the resolver cannot re-mint; denying',
      );
      throw new UnauthorizedException('Session authorization is stale');
    }

    const refreshed = await this.bffResolver.remint(sid, claims.workspaceId, ip);
    if (!refreshed) {
      // The re-mint validates workspace membership and account status, so a null
      // here usually means the user genuinely lost access.
      throw new UnauthorizedException('Invalid or expired session');
    }
    if (await this.authzEpoch.isStale(refreshed.sub, refreshed.authzEpoch)) {
      this.logger.warn(
        { userId: refreshed.sub },
        'BFF session still stale after re-mint; denying rather than retrying',
      );
      throw new UnauthorizedException('Session authorization is stale');
    }
    this.logger.log({ userId: refreshed.sub }, 'BFF session re-minted after authz epoch bump');
    return refreshed;
  }

  /**
   * Check both token-level (logout) and user-level (suspension/deactivation)
   * denylists. Best-effort: a cache outage fails open so valid users aren't
   * blocked — tokens still expire via their JWT `exp` claim.
   */
  private async enforceDenylist(jti: string, sub: string): Promise<void> {
    try {
      // Parallel lookups: saves ~1 RTT per authenticated request.
      const [tokenRevoked, userRevoked] = await Promise.all([
        this.authCache.isTokenDenied(jti),
        this.authCache.isUserRevoked(sub),
      ]);
      if (tokenRevoked || userRevoked) {
        throw new UnauthorizedException('Token has been revoked');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Tagged so the CloudWatch metric filter + alarm in infra/live/* can see
      // it — a cache outage means revoked tokens are being accepted.
      // Log AND counter: the log drives today's CloudWatch alarm, the counter drives
      // the same alert once metrics have a backend. Neither alone survives the
      // migration without a gap.
      this.logger.warn(
        failOpenLog('denylist', { err }),
        'Token denylist check failed; failing open',
      );
      this.securityMetrics.recordFailOpen('denylist');
    }
  }

  handleRequest<TUser extends { sub: string; workspaceId: string; sessionId: string }>(
    err: Error | null,
    user: TUser | false,
  ): TUser {
    if (err) {
      // Normalize unexpected infrastructure errors — don't re-throw raw DB/cache
      // errors which would produce a 500. Expected auth errors are UnauthorizedException.
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error({ err }, 'Unexpected error in JWT handleRequest');
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (!user) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Populate AsyncLocalStorage context after successful token verification
    this.ctx.setAuthContext(user.workspaceId, user.sub, user.sessionId);

    return user;
  }
}

/** True when the Authorization header carries a Bearer token. */
function hasBearerToken(authorization: string | string[] | undefined): boolean {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('bearer ');
}
