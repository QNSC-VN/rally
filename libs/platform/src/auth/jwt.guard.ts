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
import type { JwtPayload } from './jwt.strategy';

/**
 * JWT auth guard.
 * Verifies the Bearer access token, then populates request context with
 * workspaceId / userId / sessionId so downstream scoping works correctly.
 * Also checks the access-token denylist in the cache (set on logout).
 *
 * AUTHENTICATION only. The token carries no permissions — `PolicyGuard` resolves
 * those from the database per request — so there is no snapshot here that can go
 * stale, and no authorization epoch to compare. What the guard still enforces is
 * revocation: the per-token (logout) and per-user (offboarding) denylists.
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
    return true;
  }

  /**
   * Authenticate a request from a BFF session id: resolve the session, enforce the
   * same denylist as the Bearer path, then populate `req.user`, `req.bffSid`, and
   * the request context so downstream code is path-agnostic.
   */
  private async authenticateFromSession(
    req: { ip: string; user?: JwtPayload; bffSid?: string },
    sid: string,
  ): Promise<boolean> {
    const claims = await this.bffResolver!.resolve(sid, req.ip);
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    await this.enforceDenylist(claims.jti, claims.sub);

    req.user = claims;
    req.bffSid = sid;
    this.ctx.setAuthContext(claims.workspaceId, claims.sub, claims.sessionId);
    return true;
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
