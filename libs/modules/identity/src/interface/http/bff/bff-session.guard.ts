import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequestContextService } from '@platform';
import type { JwtPayload } from '@platform';
import { AuthTokenCache } from '@qnsc-vn/identity';
import { BffService } from '../../../application/bff/bff.service';
import { readCookie } from '../../../application/bff/bff.util';
import { BFF_SESSION_COOKIE } from './bff.constants';

/**
 * Authenticates a request from the opaque `__Host-` BFF session cookie instead
 * of a Bearer token. It resolves (and transparently refreshes) the server-side
 * session, then populates `req.user` and the request context exactly like
 * {@link JwtAuthGuard} does — including the same Valkey denylist check — so
 * downstream code cannot tell which auth path was used.
 *
 * Scope note: increment 1 applies this guard *only* to `/bff/*` routes. Teaching
 * the shared `@Auth()` guard to also accept the session cookie on `/api/*` is a
 * separate, additive increment; the legacy JWT path is untouched here.
 */
@Injectable()
export class BffSessionGuard implements CanActivate {
  private readonly logger = new Logger(BffSessionGuard.name);

  constructor(
    private readonly bff: BffService,
    private readonly ctx: RequestContextService,
    private readonly authCache: AuthTokenCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.bff.enabled) {
      throw new UnauthorizedException('BFF auth mode is not enabled');
    }

    const req = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: JwtPayload; bffSid?: string }>();

    const sid = readCookie(req, BFF_SESSION_COOKIE);
    if (!sid) {
      throw new UnauthorizedException('No session');
    }

    const claims = await this.bff.resolve(sid, req.ip);
    if (!claims) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    // Parity with JwtAuthGuard: honour token- and user-level denylists. Best
    // effort — a cache outage fails open, matching the Bearer path.
    try {
      const [tokenRevoked, userRevoked] = await Promise.all([
        this.authCache.isTokenDenied(claims.jti),
        this.authCache.isUserRevoked(claims.sub),
      ]);
      if (tokenRevoked || userRevoked) {
        throw new UnauthorizedException('Session has been revoked');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn({ err }, 'BFF denylist check failed; failing open');
    }

    req.user = claims;
    req.bffSid = sid;
    this.ctx.setAuthContext(claims.workspaceId, claims.sub, claims.sessionId);
    return true;
  }
}
