import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt.guard';
import type { RequestContextService } from '../context/request-context';
import type { AuthTokenCache } from '@qnsc-vn/identity';
import type { BffSessionResolver } from './bff-session-resolver';
import type { AuthzEpochService } from './authz-epoch.service';
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
  authzEpoch: 3,
} as unknown as JwtPayload;

/** What a re-mint returns: same principal, epoch caught up. */
const FRESH_CLAIMS = {
  ...CLAIMS,
  jti: 'jti-2',
  sessionId: 'sess-2',
  authzEpoch: 4,
} as unknown as JwtPayload;

describe('JwtAuthGuard — BFF session-cookie path', () => {
  let ctxService: { setAuthContext: ReturnType<typeof vi.fn> };
  let authCache: {
    isTokenDenied: ReturnType<typeof vi.fn>;
    isUserRevoked: ReturnType<typeof vi.fn>;
  };
  let resolver: {
    enabled: boolean;
    resolve: ReturnType<typeof vi.fn>;
    remint: ReturnType<typeof vi.fn>;
  };
  let authzEpoch: { isStale: ReturnType<typeof vi.fn> };
  let guard: JwtAuthGuard;
  let superCanActivate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctxService = { setAuthContext: vi.fn() };
    authCache = {
      isTokenDenied: vi.fn().mockResolvedValue(false),
      isUserRevoked: vi.fn().mockResolvedValue(false),
    };
    resolver = {
      enabled: true,
      resolve: vi.fn().mockResolvedValue(CLAIMS),
      remint: vi.fn().mockResolvedValue(FRESH_CLAIMS),
    };
    authzEpoch = { isStale: vi.fn().mockResolvedValue(false) };
    guard = new JwtAuthGuard(
      ctxService as unknown as RequestContextService,
      authCache as unknown as AuthTokenCache,
      authzEpoch as unknown as AuthzEpochService,
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
      authzEpoch as unknown as AuthzEpochService,
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

describe('JwtAuthGuard — authorization epoch staleness', () => {
  let ctxService: { setAuthContext: ReturnType<typeof vi.fn> };
  let authCache: {
    isTokenDenied: ReturnType<typeof vi.fn>;
    isUserRevoked: ReturnType<typeof vi.fn>;
  };
  let resolver: {
    enabled: boolean;
    resolve: ReturnType<typeof vi.fn>;
    remint?: ReturnType<typeof vi.fn>;
  };
  let authzEpoch: { isStale: ReturnType<typeof vi.fn> };

  function buildGuard(): JwtAuthGuard {
    return new JwtAuthGuard(
      ctxService as unknown as RequestContextService,
      authCache as unknown as AuthTokenCache,
      authzEpoch as unknown as AuthzEpochService,
      resolver as unknown as BffSessionResolver,
    );
  }

  beforeEach(() => {
    ctxService = { setAuthContext: vi.fn() };
    authCache = {
      isTokenDenied: vi.fn().mockResolvedValue(false),
      isUserRevoked: vi.fn().mockResolvedValue(false),
    };
    resolver = {
      enabled: true,
      resolve: vi.fn().mockResolvedValue(CLAIMS),
      remint: vi.fn().mockResolvedValue(FRESH_CLAIMS),
    };
    authzEpoch = { isStale: vi.fn().mockResolvedValue(false) };
    vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockResolvedValue(true);
  });

  // ── Bearer path ───────────────────────────────────────────────────────────

  it('rejects a Bearer token whose permission snapshot has been superseded', async () => {
    authzEpoch.isStale.mockResolvedValue(true);
    resolver.enabled = false;
    const req: MockReq = {
      headers: { authorization: 'Bearer abc.def.ghi' },
      ip: '1.1.1.1',
      user: { jti: 'jti-b', sub: 'user-b', authzEpoch: 1 } as unknown as JwtPayload,
    };

    await expect(buildGuard().canActivate(ctxFor(req))).rejects.toThrow('TOKEN_STALE');
    expect(authzEpoch.isStale).toHaveBeenCalledWith('user-b', 1);
  });

  it('admits a Bearer token whose snapshot is current', async () => {
    resolver.enabled = false;
    const req: MockReq = {
      headers: { authorization: 'Bearer abc.def.ghi' },
      ip: '1.1.1.1',
      user: { jti: 'jti-b', sub: 'user-b', authzEpoch: 7 } as unknown as JwtPayload,
    };

    await expect(buildGuard().canActivate(ctxFor(req))).resolves.toBe(true);
  });

  // ── BFF path ──────────────────────────────────────────────────────────────

  it('re-mints a stale BFF session in place and serves the request with fresh claims', async () => {
    // Stale on the first check (the session snapshot), current after the re-mint.
    authzEpoch.isStale.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };

    await expect(buildGuard().canActivate(ctxFor(req))).resolves.toBe(true);

    expect(resolver.remint).toHaveBeenCalledWith('sid-1', 'ws-1', '1.1.1.1');
    // The request proceeds under the re-minted principal, not the stale snapshot.
    expect(req.user).toBe(FRESH_CLAIMS);
    expect(ctxService.setAuthContext).toHaveBeenCalledWith('ws-1', 'user-1', 'sess-2');
  });

  it('does not re-mint when the BFF session snapshot is current', async () => {
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };

    await expect(buildGuard().canActivate(ctxFor(req))).resolves.toBe(true);

    expect(resolver.remint).not.toHaveBeenCalled();
    expect(req.user).toBe(CLAIMS);
  });

  it('throws 401 when the re-mint fails (membership or account revoked)', async () => {
    authzEpoch.isStale.mockResolvedValue(true);
    resolver.remint!.mockResolvedValue(null);
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };

    await expect(buildGuard().canActivate(ctxFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('denies rather than looping when the session is still stale after one re-mint', async () => {
    authzEpoch.isStale.mockResolvedValue(true); // never satisfied
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };

    await expect(buildGuard().canActivate(ctxFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(resolver.remint).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a stale session when the resolver cannot re-mint', async () => {
    authzEpoch.isStale.mockResolvedValue(true);
    delete resolver.remint;
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };

    await expect(buildGuard().canActivate(ctxFor(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // ── Fail-open ─────────────────────────────────────────────────────────────

  it('admits the request when the epoch cannot be read (cache outage)', async () => {
    // AuthzEpochService.isStale answers false on an unreadable epoch — a Valkey
    // blip must not log the fleet out.
    authzEpoch.isStale.mockResolvedValue(false);
    const req: MockReq = { headers: {}, cookies: { [BFF_SESSION_COOKIE]: 'sid-1' }, ip: '1.1.1.1' };

    await expect(buildGuard().canActivate(ctxFor(req))).resolves.toBe(true);
    expect(resolver.remint).not.toHaveBeenCalled();
  });
});
