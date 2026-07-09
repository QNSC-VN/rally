import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { USER_REPOSITORY } from '../domain/ports/user.repository';
import { AUTH_SESSION_REPOSITORY } from '../domain/ports/auth-session.repository';
import { SSO_CONNECTION_REPOSITORY } from '../domain/ports/sso-connection.repository';
import type { User, AuthSession } from '../domain/user.types';
import { UnauthorizedException, NotFoundException, AppConfigService } from '@platform';
import { DRIZZLE } from '@platform';
import { ValkeyService } from '@platform';
import { AccessService } from '@modules/access';
import { WorkspaceService } from '@modules/workspace';
import { AuditService } from '@modules/audit';

// ── Helpers ─────────────────────────────────────────────────────────────────

const mockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  status: 'active',
  emailVerified: true,
  locale: 'en',
  timezone: 'UTC',
  sessionVersion: 1,
  lastLoginAt: null,
  deletedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

const mockSession = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  id: 'session-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  tokenHash: 'hash-1',
  familyId: 'family-1',
  isRevoked: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  createdAt: new Date(),
  ssoProvider: null,
  csrfToken: null,
  ...overrides,
});

// ── Mock factories ───────────────────────────────────────────────────────────

const makeUserRepo = () => ({
  findByEmail: vi.fn(),
  findById: vi.fn(),
  updateLastLogin: vi.fn().mockResolvedValue(undefined),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  updateProfile: vi.fn(),
});

const makeSessionRepo = () => ({
  findByTokenHash: vi.fn(),
  create: vi.fn().mockResolvedValue(undefined),
  revokeById: vi.fn().mockResolvedValue(undefined),
  revokeFamily: vi.fn().mockResolvedValue(undefined),
  revokeAllForUser: vi.fn().mockResolvedValue(undefined),
});

const makeValkey = () => ({
  denylistToken: vi.fn().mockResolvedValue(undefined),
  isTokenDenied: vi.fn().mockResolvedValue(false),
});

const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  get: vi.fn((key: string) => {
    const defaults: Record<string, unknown> = {
      JWT_PRIVATE_KEY: 'test-private-key',
      JWT_PUBLIC_KEY: 'test-public-key',
      JWT_ACCESS_EXPIRY: '15m',
      JWT_REFRESH_EXPIRY: '30d',
      JWT_ISSUER: 'rally',
      JWT_AUDIENCE: 'rally-app',
      APP_BASE_URL: 'http://localhost:5173',
      PLATFORM_ADMIN_EMAILS: '',
      ...overrides,
    };
    return defaults[key];
  }),
});

const makeJwt = () => ({
  sign: vi.fn().mockReturnValue('mock-access-token'),
});

const makeAccessService = () => ({
  getUserRoleAndPermissions: vi.fn().mockResolvedValue({
    role: 'workspace_admin',
    permissions: ['workspace:*'],
  }),
  hasPermission: vi.fn().mockResolvedValue(true),
  listRoles: vi.fn().mockResolvedValue([]),
  getUserAssignments: vi.fn().mockResolvedValue([]),
  assignRole: vi.fn().mockResolvedValue(undefined),
  revokeRole: vi.fn().mockResolvedValue(undefined),
});

const makeAuditService = () => ({
  record: vi.fn().mockResolvedValue(undefined),
  listAuditLogs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
});

const makeSsoConnectionRepo = () => ({
  findByExternalTenantId: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
});

const makeWorkspaceService = () => ({
  getMemberships: vi.fn().mockResolvedValue([
    {
      workspaceId: 'ws-1',
      name: 'Test',
      slug: 'test',
      lastActiveAt: null,
      roleSlug: 'workspace_admin',
      roleName: 'Workspace Admin',
    },
  ]),
  getMembership: vi.fn().mockResolvedValue({ status: 'active' }),
  touchMembership: vi.fn().mockResolvedValue(undefined),
  enrollMember: vi.fn().mockResolvedValue(undefined),
  provisionWorkspace: vi.fn().mockResolvedValue({ id: 'workspace-1' }),
  ensureDefaultWorkspace: vi.fn().mockResolvedValue(undefined),
});

const makeDrizzle = () => ({
  transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
});

// ── Test setup ───────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof makeUserRepo>;
  let sessionRepo: ReturnType<typeof makeSessionRepo>;
  let valkey: ReturnType<typeof makeValkey>;
  let config: ReturnType<typeof makeConfig>;
  let auditService: ReturnType<typeof makeAuditService>;
  let jwt: ReturnType<typeof makeJwt>;
  let accessService: ReturnType<typeof makeAccessService>;
  let workspaceService: ReturnType<typeof makeWorkspaceService>;

  beforeEach(async () => {
    userRepo = makeUserRepo();
    sessionRepo = makeSessionRepo();
    valkey = makeValkey();
    config = makeConfig();
    jwt = makeJwt();
    accessService = makeAccessService();
    auditService = makeAuditService();
    workspaceService = makeWorkspaceService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: makeDrizzle() },
        { provide: USER_REPOSITORY, useValue: userRepo },
        { provide: AUTH_SESSION_REPOSITORY, useValue: sessionRepo },
        { provide: SSO_CONNECTION_REPOSITORY, useValue: makeSsoConnectionRepo() },
        { provide: JwtService, useValue: jwt },
        { provide: ValkeyService, useValue: valkey },
        { provide: AppConfigService, useValue: config },
        { provide: AccessService, useValue: accessService },
        { provide: WorkspaceService, useValue: workspaceService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('rotates session and returns new tokens', async () => {
      const session = mockSession();
      const user = mockUser();
      sessionRepo.findByTokenHash.mockResolvedValue(session);
      userRepo.findById.mockResolvedValue(user);

      const result = await service.refresh('some-raw-token', null);

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(sessionRepo.revokeById).toHaveBeenCalledWith(session.id, expect.anything());
      expect(sessionRepo.create).toHaveBeenCalledOnce();
    });

    it('throws when token not found', async () => {
      sessionRepo.findByTokenHash.mockResolvedValue(null);
      await expect(service.refresh('bad-token', null)).rejects.toThrow(UnauthorizedException);
    });

    it('revokes family on token reuse and throws', async () => {
      const revokedSession = mockSession({ isRevoked: true });
      sessionRepo.findByTokenHash.mockResolvedValue(revokedSession);

      await expect(service.refresh('reused-token', null)).rejects.toThrow(UnauthorizedException);
      expect(sessionRepo.revokeFamily).toHaveBeenCalledWith(revokedSession.familyId);
    });

    it('throws on expired token', async () => {
      const expiredSession = mockSession({ expiresAt: new Date(Date.now() - 1000) });
      sessionRepo.findByTokenHash.mockResolvedValue(expiredSession);

      await expect(service.refresh('expired-token', null)).rejects.toThrow(UnauthorizedException);
    });

    it('throws when user deleted', async () => {
      sessionRepo.findByTokenHash.mockResolvedValue(mockSession());
      userRepo.findById.mockResolvedValue({ ...mockUser(), deletedAt: new Date() });

      await expect(service.refresh('token', null)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── devLogin ─────────────────────────────────────────────────────────────

  describe('devLogin', () => {
    it('signs in a seeded account by email and creates a session', async () => {
      userRepo.findByEmail.mockResolvedValue(mockUser({ email: 'admin@acme.dev' }));

      const result = await service.devLogin('admin@acme.dev');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(userRepo.findByEmail).toHaveBeenCalledWith('admin@acme.dev');
      expect(sessionRepo.create).toHaveBeenCalledOnce();
      expect(userRepo.updateLastLogin).toHaveBeenCalledOnce();
    });

    it('is blocked in production', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      );

      await expect(service.devLogin('admin@acme.dev')).rejects.toThrow(UnauthorizedException);
      expect(userRepo.findByEmail).not.toHaveBeenCalled();
    });

    it('throws when no account exists for the email', async () => {
      userRepo.findByEmail.mockResolvedValue(null);

      await expect(service.devLogin('nobody@acme.dev')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the account has no workspace membership', async () => {
      userRepo.findByEmail.mockResolvedValue(mockUser());
      workspaceService.getMemberships.mockResolvedValue([]);

      await expect(service.devLogin('admin@acme.dev')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('denylists access token and revokes session', async () => {
      const payload = {
        sub: 'user-1',
        jti: 'jti-1',
        sessionId: 'session-1',
        workspaceId: 'ws-1',
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 840, // 14 min remaining
        iss: 'rally',
        aud: 'rally-app',
        permissions: [] as string[],
        authMethod: 'password' as const,
      };

      await service.logout(payload);

      expect(valkey.denylistToken).toHaveBeenCalledWith('jti-1', expect.any(Number));
      expect(sessionRepo.revokeById).toHaveBeenCalledWith('session-1');
    });

    it('skips denylist when token already expired', async () => {
      const payload = {
        sub: 'user-1',
        jti: 'jti-expired',
        sessionId: 'session-1',
        workspaceId: 'ws-1',
        iat: Math.floor(Date.now() / 1000) - 1000,
        exp: Math.floor(Date.now() / 1000) - 1, // already expired
        iss: 'rally',
        aud: 'rally-app',
        permissions: [] as string[],
        authMethod: 'password' as const,
      };

      await service.logout(payload);

      expect(valkey.denylistToken).not.toHaveBeenCalled();
      expect(sessionRepo.revokeById).toHaveBeenCalledWith('session-1');
    });
  });

  // ── logoutAll ──────────────────────────────────────────────────────────────

  describe('logoutAll', () => {
    it('denylists current token and revokes all user sessions', async () => {
      const payload = {
        sub: 'user-1',
        jti: 'jti-1',
        sessionId: 'session-1',
        workspaceId: 'ws-1',
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 840,
        iss: 'rally',
        aud: 'rally-app',
        permissions: [] as string[],
        authMethod: 'password' as const,
      };

      await service.logoutAll(payload);

      expect(valkey.denylistToken).toHaveBeenCalled();
      expect(sessionRepo.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });
  });

  // ── getMe ──────────────────────────────────────────────────────────────────

  describe('getMe', () => {
    it('returns user for valid id', async () => {
      const user = mockUser();
      userRepo.findById.mockResolvedValue(user);

      const result = await service.getMe('user-1');
      expect(result.email).toBe('alice@example.com');
    });

    it('throws NotFoundException when not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      await expect(service.getMe('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for deleted user', async () => {
      userRepo.findById.mockResolvedValue(mockUser({ deletedAt: new Date() }));
      await expect(service.getMe('user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('calls updateProfile on repo and returns updated user', async () => {
      const user = mockUser();
      const updated = { ...user, displayName: 'Alice Updated' };
      userRepo.findById.mockResolvedValue(user);
      userRepo.updateProfile.mockResolvedValue(updated);

      const result = await service.updateProfile('user-1', { displayName: 'Alice Updated' });
      expect(result.displayName).toBe('Alice Updated');
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      await expect(service.updateProfile('x', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── switchWorkspace ──────────────────────────────────────────────────────────

  describe('switchWorkspace', () => {
    const makePayload = () => ({
      sub: 'user-1',
      jti: 'jti-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-from',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 840,
      iss: 'rally',
      aud: 'rally-app',
      permissions: [] as string[],
      authMethod: 'password' as const,
    });

    it('rotates the session to the target workspace for an active member', async () => {
      workspaceService.getMembership.mockResolvedValue({ status: 'active' });
      userRepo.findById.mockResolvedValue(mockUser());

      const result = await service.switchWorkspace(makePayload(), 'workspace-to');

      expect(result.accessToken).toBe('mock-access-token');
      expect(workspaceService.getMembership).toHaveBeenCalledWith('user-1', 'workspace-to');
      expect(sessionRepo.revokeById).toHaveBeenCalledWith('session-1', expect.anything());
      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'workspace-to' }),
        expect.anything(),
      );
      expect(workspaceService.touchMembership).toHaveBeenCalledWith('user-1', 'workspace-to');
    });

    it('throws WORKSPACE_ACCESS_DENIED when caller is not a member', async () => {
      workspaceService.getMembership.mockResolvedValue(null);

      await expect(service.switchWorkspace(makePayload(), 'workspace-to')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionRepo.create).not.toHaveBeenCalled();
    });

    it('throws WORKSPACE_ACCESS_DENIED when the membership is not active', async () => {
      workspaceService.getMembership.mockResolvedValue({ status: 'suspended' });

      await expect(service.switchWorkspace(makePayload(), 'workspace-to')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionRepo.create).not.toHaveBeenCalled();
    });
  });
});
