import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { USER_REPOSITORY } from '../domain/ports/user.repository';
import { AUTH_SESSION_REPOSITORY } from '../domain/ports/auth-session.repository';
import { SSO_CONNECTION_REPOSITORY } from '../domain/ports/sso-connection.repository';
import type { User, AuthSession } from '../domain/user.types';
import {
  UnauthorizedException,
  NotFoundException,
  AppConfigService,
  EmailSchedulerService,
  TenantRlsService,
} from '@platform';
import { DRIZZLE } from '@platform';
import { ValkeyService } from '@platform';
import { AccessService } from '@modules/access';
import { TenancyService } from '@modules/tenancy';
import { AuditService } from '@modules/audit';

// ── Helpers ─────────────────────────────────────────────────────────────────

const mockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  passwordHash: null,
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
  tenantId: 'tenant-1',
  userId: 'user-1',
  tokenHash: 'hash-1',
  familyId: 'family-1',
  isRevoked: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  createdAt: new Date(),
  ssoProvider: null,
  ...overrides,
});

// ── Mock factories ───────────────────────────────────────────────────────────

const makeUserRepo = () => ({
  findByEmail: vi.fn(),
  findById: vi.fn(),
  updateLastLogin: vi.fn().mockResolvedValue(undefined),
  updatePasswordHash: vi.fn().mockResolvedValue(undefined),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  updateProfile: vi.fn(),
  createPasswordResetToken: vi.fn().mockResolvedValue(undefined),
  findPasswordResetToken: vi.fn(),
  markPasswordResetTokenUsed: vi.fn().mockResolvedValue(undefined),
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
      PASSWORD_RESET_TOKEN_TTL_HOURS: 2,
      APP_BASE_URL: 'http://localhost:5173',
      BREAKGLASS_EMAIL: 'breakglass@test.internal',
      PLATFORM_ADMIN_EMAILS: '',
      ...overrides,
    };
    return defaults[key];
  }),
});

const makeEmailScheduler = () => ({
  schedule: vi.fn().mockResolvedValue(undefined),
});

// Executes the wrapped unit of work immediately with a stub transaction, so the
// repository mocks receive a (truthy) tx argument just like production.
const makeRls = () => ({
  withTenantContext: vi.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
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
  findByTenantId: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
});

const makeTenancyService = () => ({
  getMemberships: vi
    .fn()
    .mockResolvedValue([
      {
        tenantId: 'tenant-1',
        tenantName: 'Test',
        tenantSlug: 'test',
        lastActiveAt: null,
        roleSlug: 'workspace_admin',
        roleName: 'Workspace Admin',
      },
    ]),
  getTenantMember: vi.fn().mockResolvedValue({ status: 'active' }),
  touchTenantMembership: vi.fn().mockResolvedValue(undefined),
  tenantMemberCreate: vi.fn().mockResolvedValue(undefined),
  enrollMember: vi.fn().mockResolvedValue(undefined),
  findAutoJoinTarget: vi.fn().mockResolvedValue(null),
  isDomainClaimed: vi.fn().mockResolvedValue(false),
  provisionTenant: vi
    .fn()
    .mockResolvedValue({ tenant: { id: 'tenant-1' }, workspace: { id: 'ws-1' } }),
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
  let emailScheduler: ReturnType<typeof makeEmailScheduler>;
  let auditService: ReturnType<typeof makeAuditService>;
  let rls: ReturnType<typeof makeRls>;
  let jwt: ReturnType<typeof makeJwt>;
  let accessService: ReturnType<typeof makeAccessService>;

  beforeEach(async () => {
    userRepo = makeUserRepo();
    sessionRepo = makeSessionRepo();
    valkey = makeValkey();
    config = makeConfig();
    emailScheduler = makeEmailScheduler();
    rls = makeRls();
    jwt = makeJwt();
    accessService = makeAccessService();
    auditService = makeAuditService();

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
        { provide: EmailSchedulerService, useValue: emailScheduler },
        { provide: TenantRlsService, useValue: rls },
        { provide: AccessService, useValue: accessService },
        { provide: TenancyService, useValue: makeTenancyService() },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    let user: User;

    beforeEach(async () => {
      const hash = await argon2.hash('correct-password', { type: argon2.argon2id });
      user = mockUser({ passwordHash: hash });
      userRepo.findByEmail.mockResolvedValue(user);
    });

    it('returns tokens + user on valid credentials', async () => {
      const result = await service.login('alice@example.com', 'correct-password');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('alice@example.com');
      expect(sessionRepo.create).toHaveBeenCalledOnce();
      expect(userRepo.updateLastLogin).toHaveBeenCalledWith(user.id, expect.anything());
    });

    it('normalises email to lowercase', async () => {
      await service.login('ALICE@Example.com', 'correct-password');
      expect(userRepo.findByEmail).toHaveBeenCalledWith('alice@example.com');
    });

    it('throws UnauthorizedException on wrong password', async () => {
      await expect(service.login('alice@example.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user not found (and does constant-time work)', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      await expect(service.login('nobody@example.com', 'any')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for suspended user', async () => {
      userRepo.findByEmail.mockResolvedValue({ ...user, status: 'suspended' });
      await expect(service.login('alice@example.com', 'correct-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for deleted user', async () => {
      userRepo.findByEmail.mockResolvedValue({ ...user, deletedAt: new Date() });
      await expect(service.login('alice@example.com', 'correct-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for invited user', async () => {
      userRepo.findByEmail.mockResolvedValue({ ...user, status: 'invited' });
      await expect(service.login('alice@example.com', 'correct-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('rotates session and returns new tokens', async () => {
      const session = mockSession();
      const user = mockUser();
      sessionRepo.findByTokenHash.mockResolvedValue(session);
      userRepo.findById.mockResolvedValue(user);

      const result = await service.refresh('some-raw-token');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(sessionRepo.revokeById).toHaveBeenCalledWith(session.id, expect.anything());
      expect(sessionRepo.create).toHaveBeenCalledOnce();
    });

    it('throws when token not found', async () => {
      sessionRepo.findByTokenHash.mockResolvedValue(null);
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('revokes family on token reuse and throws', async () => {
      const revokedSession = mockSession({ isRevoked: true });
      sessionRepo.findByTokenHash.mockResolvedValue(revokedSession);

      await expect(service.refresh('reused-token')).rejects.toThrow(UnauthorizedException);
      expect(sessionRepo.revokeFamily).toHaveBeenCalledWith(revokedSession.familyId);
    });

    it('throws on expired token', async () => {
      const expiredSession = mockSession({ expiresAt: new Date(Date.now() - 1000) });
      sessionRepo.findByTokenHash.mockResolvedValue(expiredSession);

      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when user deleted', async () => {
      sessionRepo.findByTokenHash.mockResolvedValue(mockSession());
      userRepo.findById.mockResolvedValue({ ...mockUser(), deletedAt: new Date() });

      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('denylists access token and revokes session', async () => {
      const payload = {
        sub: 'user-1',
        jti: 'jti-1',
        sessionId: 'session-1',
        tenantId: 'tenant-1',
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 840, // 14 min remaining
        iss: 'rally',
        aud: 'rally-app',
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
        tenantId: 'tenant-1',
        iat: Math.floor(Date.now() / 1000) - 1000,
        exp: Math.floor(Date.now() / 1000) - 1, // already expired
        iss: 'rally',
        aud: 'rally-app',
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
        tenantId: 'tenant-1',
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 840,
        iss: 'rally',
        aud: 'rally-app',
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

  // ── changePassword ─────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password hash on success', async () => {
      const hash = await argon2.hash('old-pass', { type: argon2.argon2id });
      userRepo.findById.mockResolvedValue(mockUser({ passwordHash: hash }));

      await service.changePassword('user-1', 'old-pass', 'new-pass-secure');

      expect(userRepo.updatePasswordHash).toHaveBeenCalledWith('user-1', expect.any(String));
    });

    it('throws when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);
      await expect(service.changePassword('x', 'old', 'new')).rejects.toThrow(NotFoundException);
    });

    it('throws when no password set (OAuth account)', async () => {
      userRepo.findById.mockResolvedValue(mockUser({ passwordHash: null }));
      await expect(service.changePassword('user-1', 'old', 'new')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws on wrong current password', async () => {
      const hash = await argon2.hash('correct-pass', { type: argon2.argon2id });
      userRepo.findById.mockResolvedValue(mockUser({ passwordHash: hash }));

      await expect(service.changePassword('user-1', 'wrong-pass', 'new')).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Current password is incorrect',
        httpStatus: 400,
      });
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

  // ── forgotPassword ─────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('creates reset token and sends email for active user', async () => {
      const user = mockUser({ status: 'active' });
      userRepo.findByEmail.mockResolvedValue(user);

      await service.forgotPassword('alice@example.com');

      expect(userRepo.createPasswordResetToken).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        expect.any(Date),
        expect.anything(),
      );
      expect(emailScheduler.schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          template: 'password-reset',
          vars: expect.objectContaining({
            resetUrl: expect.stringContaining('/reset-password?token='),
          }),
        }),
        expect.anything(),
      );
    });

    it('silently does nothing when user not found (user enumeration prevention)', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      await expect(service.forgotPassword('nobody@example.com')).resolves.toEqual({});
      expect(emailScheduler.schedule).not.toHaveBeenCalled();
    });

    it('silently does nothing for deleted user', async () => {
      userRepo.findByEmail.mockResolvedValue(mockUser({ deletedAt: new Date() }));
      await expect(service.forgotPassword('alice@example.com')).resolves.toEqual({});
      expect(emailScheduler.schedule).not.toHaveBeenCalled();
    });

    it('silently does nothing for non-active user', async () => {
      userRepo.findByEmail.mockResolvedValue(mockUser({ status: 'suspended' }));
      await expect(service.forgotPassword('alice@example.com')).resolves.toEqual({});
      expect(emailScheduler.schedule).not.toHaveBeenCalled();
    });

    it('uses APP_BASE_URL from config to build reset URL', async () => {
      userRepo.findByEmail.mockResolvedValue(mockUser({ status: 'active' }));
      await service.forgotPassword('alice@example.com');

      expect(emailScheduler.schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          vars: expect.objectContaining({
            resetUrl: expect.stringContaining('http://localhost:5173'),
          }),
        }),
        expect.anything(),
      );
    });
  });

  // ── resetPassword ──────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    const makeResetToken = () => ({
      id: 'reset-token-id',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 3600_000),
      usedAt: null,
      createdAt: new Date(),
    });

    it('updates password and revokes all sessions on success', async () => {
      userRepo.findPasswordResetToken.mockResolvedValue(makeResetToken());
      userRepo.findById.mockResolvedValue(mockUser());

      await service.resetPassword('raw-token', 'new-secure-password');

      expect(userRepo.updatePasswordHash).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        expect.anything(),
      );
      expect(userRepo.markPasswordResetTokenUsed).toHaveBeenCalledWith(
        'reset-token-id',
        expect.anything(),
      );
      expect(sessionRepo.revokeAllForUser).toHaveBeenCalledWith('user-1', expect.anything());
    });

    it('throws when token not found', async () => {
      userRepo.findPasswordResetToken.mockResolvedValue(null);
      await expect(service.resetPassword('bad-token', 'new-pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when token already used', async () => {
      userRepo.findPasswordResetToken.mockResolvedValue({
        ...makeResetToken(),
        usedAt: new Date(),
      });
      await expect(service.resetPassword('used-token', 'new-pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when token expired', async () => {
      userRepo.findPasswordResetToken.mockResolvedValue({
        ...makeResetToken(),
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.resetPassword('expired-token', 'new-pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── hashPassword (static) ──────────────────────────────────────────────────

  describe('hashPassword', () => {
    it('produces a valid argon2id hash', async () => {
      const hash = await AuthService.hashPassword('secret');
      expect(await argon2.verify(hash, 'secret')).toBe(true);
    });
  });
});
