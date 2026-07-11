import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt.guard';
import type { RequestContextService } from '../context/request-context';
import type { AuthTokenCache } from '@qnsc-vn/identity';
import type { BffSessionResolver } from './bff-session-resolver';
import { BFF_SESSION_COOKIE } from './bff-session-resolver';
import type { JwtPayload } from './jwt.strategy';

type MockReq = {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip: string;
  user?: JwtPayload;
  bffSid?: string;
};

function ctxFor(req: MockReq): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const CLAIMS = {
  sub: 'user-1',
  jti: 'jti-1',
  sessionId: 'sess-1',
  workspaceId: 'ws-1',
  contextId: 'ws-1',
  permissions: [],
} as unknown as JwtPayload;

describe('JwtAuthGuard — BFF session-cookie path', () => {
  let ctxService: { setAuthContext: ReturnType<typeof vi.fn> };
  let authCache: {
    isTokenDenied: ReturnType<typeof vi.fn>;
    isUserRevoked: ReturnType<typeof vi.fn>;
  };
  let resolver: { enabled: boolean; resolve: ReturnType<typeof vi.fn> };
  let guard: JwtAuthGuard;
  let superCanActivate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctxService = { setAuthContext: vi.fn() };
    authCache = {
      isTokenDenied: vi.fn().mockResolvedValue(false),
      isUserRevoked: vi.fn().mockResolvedValue(false),
    };
    resolver = { enabled: true, resolve: vi.fn().mockResolvedValue(CLAIMS) };
    guard = new JwtAuthGuard(
      ctxService as unknown as RequestContextService,
      authCache as unknown as AuthTokenCache,
      resolver as unknown as BffSessionResolver,
    );
    // Neutralise the passport Bearer path so "falls through" cases are observable.
    superCanActivate = vi
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockResolvedValue(true);
  });

  it('authenticates from the session cookie when enabled and no Bearer token', async () => {
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);

    expect(resolver.resolve).toHaveBeenCalledWith('sid-1', '1.1.1.1');
    expect(superCanActivate).not.toHaveBeenCalled();
    expect(req.user).toBe(CLAIMS);
    expect(req.bffSid).toBe('sid-1');
    expect(ctxService.setAuthContext).toHaveBeenCalledWith('ws-1', 'user-1', 'sess-1');
    expect(authCache.isTokenDenied).toHaveBeenCalledWith('jti-1');
  });

  it('throws 401 when the session cannot be resolved', async () => {
    resolver.resolve.mockResolvedValue(null);
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-x' }, ip: '1.1.1.1' };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when the resolved session is on the denylist', async () => {
    authCache.isUserRevoked.mockResolvedValue(true);
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('prefers the Bearer path when an Authorization header is present', async () => {
    const req: MockReq = {
      headers: { authorization: 'Bearer abc.def.ghi' },
      cookies: { [BFF_SESSION_COOKIE]: 'sid-1' },
      ip: '1.1.1.1',
      user: { jti: 'jti-b', sub: 'user-b' } as unknown as JwtPayload,
    };

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(superCanActivate).toHaveBeenCalled();
    expect(authCache.isTokenDenied).toHaveBeenCalledWith('jti-b');
  });

  it('skips the session path entirely when the resolver is disabled', async () => {
    resolver.enabled = false;
    const req: MockReq = {
      headers: {},
      cookies: { [BFF_SESSION_COOKIE]: 'sid-1' },
      ip: '1.1.1.1',
      user: { jti: 'jti-c', sub: 'user-c' } as unknown as JwtPayload,
    };

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(superCanActivate).toHaveBeenCalled();
  });

  it('works with no resolver bound (legacy JWT-only wiring)', async () => {
    const legacyGuard = new JwtAuthGuard(
      ctxService as unknown as RequestContextService,
      authCache as unknown as AuthTokenCache,
    );
    const req: MockReq = {
      headers: {},
      cookies: { [BFF_SESSION_COOKIE]: 'sid-1' },
      ip: '1.1.1.1',
      user: { jti: 'jti-d', sub: 'user-d' } as unknown as JwtPayload,
    };

    await expect(legacyGuard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(superCanActivate).toHaveBeenCalled();
  });
});
