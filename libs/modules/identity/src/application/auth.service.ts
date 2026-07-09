import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { uuidv7 } from 'uuidv7';
import {
  AppConfigService,
  ValkeyService,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  Span,
  EmailSchedulerService,
  addHours,
  parseDurationToSeconds,
  InjectDrizzle,
} from '@platform';
import type { JwtPayload, DrizzleDB } from '@platform';
import { SYSTEM_ROLE } from '@shared-kernel';
import { AccessService } from '@modules/access';
import { WorkspaceService } from '@modules/workspace';
import type { WorkspaceMembership } from '@modules/workspace';
import { AuditService } from '@modules/audit';
import { IUserRepository, USER_REPOSITORY } from '../domain/ports/user.repository';
import {
  IAuthSessionRepository,
  AUTH_SESSION_REPOSITORY,
} from '../domain/ports/auth-session.repository';
import {
  ISsoConnectionRepository,
  SSO_CONNECTION_REPOSITORY,
} from '../domain/ports/sso-connection.repository';
import type { User } from '../domain/user.types';

const SESSION_TTL_SECONDS = 24 * 60 * 60;       // 24 h
const REMEMBER_ME_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  csrfToken: string;
  user: Pick<User, 'id' | 'email' | 'displayName' | 'avatarUrl' | 'locale' | 'timezone'>;
  /** All active workspace memberships, most-recently-active first. Drives the workspace switcher. */
  memberships: WorkspaceMembership[];
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  csrfToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(AUTH_SESSION_REPOSITORY) private readonly sessionRepo: IAuthSessionRepository,
    @Inject(SSO_CONNECTION_REPOSITORY) private readonly ssoConnectionRepo: ISsoConnectionRepository,
    private readonly jwt: JwtService,
    private readonly valkey: ValkeyService,
    private readonly config: AppConfigService,
    private readonly emailScheduler: EmailSchedulerService,
    private readonly accessService: AccessService,
    private readonly workspaceService: WorkspaceService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  @Span('auth.login')
  async login(
    email: string,
    password: string,
    ipAddress?: string,
    rememberMe = false,
  ): Promise<LoginResult> {
    const user = await this.userRepo.findByEmail(email.toLowerCase().trim());

    // Use constant-time comparison to prevent user enumeration
    if (!user || !user.passwordHash) {
      await argon2
        .verify('$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder', password)
        .catch(() => null);
      throw new UnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
    }

    if (user.deletedAt || user.status === 'suspended' || user.status === 'inactive') {
      throw new UnauthorizedException('USER_DEACTIVATED', 'Account is not active');
    }

    if (user.status === 'invited') {
      throw new UnauthorizedException('USER_DEACTIVATED', 'Account has not been activated yet');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const sessionId = uuidv7();
    // Load keycards — pick the most-recently-active workspace.
    const memberships = await this.workspaceService.getMemberships(user.id);
    const activeWorkspaceId = memberships[0]?.workspaceId;
    if (!activeWorkspaceId) {
      throw new UnauthorizedException('ACCOUNT_DEACTIVATED', 'No active workspace membership found');
    }

    // Auto-elevate platform admins to workspace_admin on every login.
    const platformAdminEmails = (this.config.get('PLATFORM_ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    let updatedMemberships = memberships;
    if (platformAdminEmails.includes(user.email.toLowerCase())) {
      const elevated = await this.accessService.elevateToWorkspaceAdmin(user.id, activeWorkspaceId);
      // Re-fetch so the response reflects the new role
      updatedMemberships = await this.workspaceService.getMemberships(user.id);
      if (elevated) {
        void this.audit.record({
          workspaceId: activeWorkspaceId,
          actorId: user.id,
          actorEmail: user.email,
          action: 'access.role_elevated',
          resourceType: 'user',
          resourceId: user.id,
          ipAddress,
          metadata: { role: 'workspace_admin', via: 'PLATFORM_ADMIN_EMAILS' },
        });
      }
    }

    const { permissions } = await this.accessService.getUserRoleAndPermissions(
      user.id,
      activeWorkspaceId,
    );
    const { accessToken, jti, expiresIn } = this.signAccessToken(
      user,
      sessionId,
      permissions,
      activeWorkspaceId,
    );
    const { refreshToken, tokenHash, familyId } = this.generateRefreshToken();

    // AUTH-FR: rememberMe = 30d session; not remembered = 24h session
    const ttlSeconds = rememberMe ? this.refreshTtlSeconds() : SESSION_TTL_SECONDS;
    const refreshExpiry = new Date();
    refreshExpiry.setSeconds(refreshExpiry.getSeconds() + ttlSeconds);

    const csrfToken = randomBytes(32).toString('hex');

    await this.db.transaction(async (tx) => {
      await this.sessionRepo.create(
        {
          id: sessionId,
          workspaceId: activeWorkspaceId,
          userId: user.id,
          tokenHash,
          familyId,
          ipAddress,
          expiresAt: refreshExpiry,
          csrfToken,
        },
        tx,
      );
      await this.userRepo.updateLastLogin(user.id, tx);
    });

    this.logger.log({ userId: user.id, jti, sessionId }, 'User logged in');

    // Fire-and-forget: touch last-active for the workspace switcher + audit trail
    void this.workspaceService.touchMembership(user.id, activeWorkspaceId);
    void this.audit.record({
      workspaceId: activeWorkspaceId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login',
      resourceType: 'session',
      resourceId: sessionId,
      ipAddress,
      metadata: { method: 'password' },
    });

    // Break-glass alert: every login on the dedicated emergency account triggers a
    // high-severity audit record and email notification to all platform admins.
    const breakglassEmail = this.config.get('BREAKGLASS_EMAIL');
    if (breakglassEmail && user.email.toLowerCase() === breakglassEmail.toLowerCase()) {
      this.logger.warn(
        { userId: user.id, sessionId, ipAddress, email: user.email },
        'SECURITY: Break-glass account login detected',
      );
      void this.audit.record({
        workspaceId: activeWorkspaceId,
        actorId: user.id,
        actorEmail: user.email,
        action: 'auth.breakglass_login',
        resourceType: 'session',
        resourceId: sessionId,
        ipAddress,
        metadata: { alert: 'BREAKGLASS_LOGIN', severity: 'critical' },
      });
      const adminEmails = (this.config.get('PLATFORM_ADMIN_EMAILS') ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
      const baseUrl = this.config.get('APP_BASE_URL');
      for (const adminEmail of adminEmails) {
        const alertKey = this.hashToken(`breakglass-alert:${sessionId}:${adminEmail}`);
        void this.db.transaction(async (tx) => {
          await this.emailScheduler.schedule(
            {
              to: adminEmail,
              template: 'notification',
              vars: {
                title: 'Security Alert: Break-glass account login',
                body: `The break-glass administrator account (${user.email}) signed in${ipAddress ? ` from IP ${ipAddress}` : ''}. If you did not initiate this, revoke all sessions immediately.`,
                resourceType: 'security event',
                appUrl: baseUrl,
              },
              idempotencyKey: alertKey,
            },
            tx,
          );
        });
      }
    }

    return {
      accessToken,
      refreshToken,
      expiresIn,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        timezone: user.timezone,
      },
      memberships: updatedMemberships,
    };
  }

  // ---------------------------------------------------------------------------
  // Sign up (self-serve) — creates or joins a workspace by email domain
  // ---------------------------------------------------------------------------

  @Span('auth.signup')
  async signup(
    input: { email: string; password: string; displayName: string; organizationName?: string },
    ipAddress?: string,
  ): Promise<LoginResult> {
    const email = input.email.toLowerCase().trim();

    // Email is globally unique — one email maps to exactly one account.
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new ConflictException(
        'EMAIL_ALREADY_REGISTERED',
        'An account with this email already exists',
      );
    }

    const passwordHash = await AuthService.hashPassword(input.password);

    const user = await this.userRepo.create({
      email,
      displayName: input.displayName,
      passwordHash,
    });

    // Provision a fresh workspace for the signer and make them its admin. There
    // is no cross-workspace auto-join: every self-serve signup gets its own root
    // workspace.
    const orgName =
      input.organizationName?.trim() || this.defaultOrgName(input.displayName, email);
    const workspace = await this.workspaceService.provisionWorkspace(orgName, user.id);
    const workspaceId = workspace.id;
    await this.accessService.ensureDefaultRole(user.id, workspaceId, SYSTEM_ROLE.WORKSPACE_ADMIN);

    // Issue a login session (mirrors login()).
    const sessionId = uuidv7();
    const memberships = await this.workspaceService.getMemberships(user.id);
    const { permissions } = await this.accessService.getUserRoleAndPermissions(user.id, workspaceId);
    const { accessToken, jti, expiresIn } = this.signAccessToken(
      user,
      sessionId,
      permissions,
      workspaceId,
    );
    const { refreshToken, tokenHash, familyId } = this.generateRefreshToken();
    const refreshExpiry = new Date();
    refreshExpiry.setSeconds(refreshExpiry.getSeconds() + this.refreshTtlSeconds());

    const csrfToken = randomBytes(32).toString('hex');

    await this.db.transaction(async (tx) => {
      await this.sessionRepo.create(
        {
          id: sessionId,
          workspaceId,
          userId: user.id,
          tokenHash,
          familyId,
          ipAddress,
          expiresAt: refreshExpiry,
          csrfToken,
        },
        tx,
      );
      await this.userRepo.updateLastLogin(user.id, tx);
    });

    this.logger.log({ userId: user.id, workspaceId, jti, sessionId }, 'User signed up');

    void this.workspaceService.touchMembership(user.id, workspaceId);
    void this.audit.record({
      workspaceId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.signup',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      metadata: { mode: 'new-workspace' },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        timezone: user.timezone,
      },
      memberships,
    };
  }

  private defaultOrgName(displayName: string, email: string): string {
    const first = displayName.trim().split(/\s+/)[0] || email.split('@')[0];
    return `${first}'s Workspace`;
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  @Span('auth.refresh')
  async refresh(rawRefreshToken: string, csrfToken: string | null, ipAddress?: string): Promise<RefreshResult> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const session = await this.sessionRepo.findByTokenHash(tokenHash);

    if (!session) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID', 'Refresh token not found');
    }

    // Token reuse detected — revoke entire family (session hijacking prevention)
    if (session.isRevoked) {
      await this.sessionRepo.revokeFamily(session.familyId);
      this.logger.warn(
        { sessionId: session.id, familyId: session.familyId },
        'Refresh token reuse detected — revoking entire family',
      );
      // Audit trail for security incident detection (SOC 2 CC6.8)
      void this.audit.record({
        workspaceId: session.workspaceId,
        actorId: session.userId,
        action: 'auth.token_theft_detected',
        resourceType: 'session',
        resourceId: session.familyId,
        metadata: { familyId: session.familyId },
      });
      throw new UnauthorizedException('AUTH_REFRESH_TOKEN_REUSE', 'Refresh token has been revoked');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('AUTH_TOKEN_EXPIRED', 'Refresh token has expired');
    }

    const user = await this.userRepo.findById(session.userId);
    // AUTH-FR-013: suspended/inactive accounts must not receive new access tokens
    if (!user || user.deletedAt || user.status === 'suspended' || user.status === 'inactive') {
      throw new UnauthorizedException('USER_DEACTIVATED', 'User not found or deactivated');
    }

    // Enforce CSRF check for sessions that have a token (all sessions post-migration).
    // Sessions without csrf_token are pre-migration; allow once, new session gets a token.
    if (session.csrfToken !== null) {
      if (!csrfToken || csrfToken !== session.csrfToken) {
        throw new UnauthorizedException('AUTH_TOKEN_INVALID', 'CSRF token mismatch');
      }
    }

    // Revoke old session and issue new tokens (rotation)
    const newSessionId = uuidv7();
    // Preserve the auth method across rotations so the frontend knows which
    // refresh path to use (MSAL silent re-auth for SSO vs Rally-only for password).
    const authMethod: 'password' | 'sso' = session.ssoProvider ? 'sso' : 'password';
    const { permissions } = await this.accessService.getUserRoleAndPermissions(
      user.id,
      session.workspaceId,
    );
    const { accessToken, expiresIn } = this.signAccessToken(
      user,
      newSessionId,
      permissions,
      session.workspaceId,
      authMethod,
    );
    const { refreshToken: newRefreshToken, tokenHash: newHash } = this.generateRefreshToken();

    const refreshExpiry = new Date();
    refreshExpiry.setSeconds(refreshExpiry.getSeconds() + this.refreshTtlSeconds());

    const newCsrfToken = randomBytes(32).toString('hex');

    // Atomic token rotation: revoke old session and issue new in one tx.
    // If either write fails the whole rotation rolls back, so we never end up
    // with two live refresh tokens (token-reuse / privilege-escalation gap).
    await this.db.transaction(async (tx) => {
      await this.sessionRepo.revokeById(session.id, tx);
      await this.sessionRepo.create(
        {
          id: newSessionId,
          workspaceId: session.workspaceId,
          userId: user.id,
          tokenHash: newHash,
          familyId: session.familyId, // preserve family for revocation chain
          ipAddress,
          expiresAt: refreshExpiry,
          ssoProvider: session.ssoProvider ?? undefined, // carry SSO provider forward
          csrfToken: newCsrfToken,
        },
        tx,
      );
    });

    return { accessToken, refreshToken: newRefreshToken, expiresIn, csrfToken: newCsrfToken };
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  @Span('auth.logout')
  async logout(payload: JwtPayload): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(payload.exp - now, 0);

    await Promise.all([
      // Denylist access token until its natural expiry
      ttl > 0 ? this.valkey.denylistToken(payload.jti, ttl) : Promise.resolve(),
      // Revoke refresh session in DB
      this.sessionRepo.revokeById(payload.sessionId),
    ]);

    this.logger.log({ userId: payload.sub, jti: payload.jti }, 'User logged out');

    void this.audit.record({
      workspaceId: payload.workspaceId,
      actorId: payload.sub,
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: payload.sessionId,
      metadata: { jti: payload.jti },
    });
  }

  // ---------------------------------------------------------------------------
  // SSO login — Microsoft Entra ID (OIDC)
  // ---------------------------------------------------------------------------

  @Span('auth.ssoLogin')
  async ssoLogin(idToken: string, ipAddress?: string): Promise<LoginResult> {
    const workspaceId = this.config.get('ENTRA_TENANT_ID');
    const clientId = this.config.get('ENTRA_CLIENT_ID');

    if (!workspaceId || !clientId) {
      throw new UnauthorizedException('SSO_NOT_CONFIGURED', 'SSO is not configured on this server');
    }

    // Verify the Entra ID token signature and claims using Microsoft's JWKS
    const JWKS = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${workspaceId}/discovery/v2.0/keys`),
    );

    let claims: {
      sub?: unknown;
      oid?: unknown;
      email?: unknown;
      preferred_username?: unknown;
      upn?: unknown;
      name?: unknown;
      tid?: unknown;
    };
    try {
      const result = await jwtVerify(idToken, JWKS, {
        issuer: [
          `https://login.microsoftonline.com/${workspaceId}/v2.0`,
          `https://sts.windows.net/${workspaceId}/`,
        ],
        audience: clientId,
      });
      claims = result.payload;
    } catch {
      throw new UnauthorizedException('SSO_TOKEN_INVALID', 'Entra ID token is invalid or expired');
    }

    // Extract standard OIDC claims — Entra uses `oid` as the stable user ID
    const oid = typeof claims.oid === 'string' ? claims.oid : null;
    const email =
      typeof claims.email === 'string'
        ? claims.email
        : typeof claims.preferred_username === 'string'
          ? claims.preferred_username
          : typeof claims.upn === 'string'
            ? claims.upn
            : null;
    const displayName = typeof claims.name === 'string' ? claims.name : (email ?? 'Unknown');
    // Entra `tid` — the IdP directory id used to resolve the Rally workspace.
    const externalTenantId = typeof claims.tid === 'string' ? claims.tid : null;

    if (!oid || !email) {
      throw new UnauthorizedException(
        'SSO_CLAIMS_MISSING',
        'Required OIDC claims (oid, email) are missing',
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Look up existing SSO identity first (fast path — avoids workspace lookup)
    const existingIdentity = await this.userRepo.findSsoIdentity('entra', oid);

    let user: User;
    let ssoWorkspaceId: string;
    if (existingIdentity) {
      const found = await this.userRepo.findById(existingIdentity.userId);
      if (
        !found ||
        found.deletedAt ||
        found.status === 'suspended' ||
        found.status === 'inactive'
      ) {
        throw new UnauthorizedException('USER_DEACTIVATED', 'Account is not active');
      }
      user = found;
      // Determine active workspace from memberships (most-recently-active first).
      const membershipsEarly = await this.workspaceService.getMemberships(user.id);
      ssoWorkspaceId = membershipsEarly[0]?.workspaceId ?? '';
      if (!ssoWorkspaceId) {
        throw new UnauthorizedException('ACCOUNT_DEACTIVATED', 'No active workspace membership found');
      }
    } else {
      const provisioned = await this.resolveAndProvisionSsoUser({
        oid,
        email: normalizedEmail,
        displayName,
        externalTenantId,
      });
      user = provisioned.user;
      ssoWorkspaceId = provisioned.workspaceId;
    }

    // Auto-elevate platform admins to workspace_admin on every SSO login.
    const platformAdminEmails = (this.config.get('PLATFORM_ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (platformAdminEmails.includes(user.email.toLowerCase())) {
      const elevated = await this.accessService.elevateToWorkspaceAdmin(user.id, ssoWorkspaceId);
      if (elevated) {
        void this.audit.record({
          workspaceId: ssoWorkspaceId,
          actorId: user.id,
          actorEmail: user.email,
          action: 'access.role_elevated',
          resourceType: 'user',
          resourceId: user.id,
          ipAddress,
          metadata: { role: 'workspace_admin', via: 'PLATFORM_ADMIN_EMAILS', method: 'sso' },
        });
      }
    }

    const sessionId = uuidv7();
    const { permissions } = await this.accessService.getUserRoleAndPermissions(
      user.id,
      ssoWorkspaceId,
    );
    const { accessToken, jti, expiresIn } = this.signAccessToken(
      user,
      sessionId,
      permissions,
      ssoWorkspaceId,
      'sso',
    );
    const { refreshToken, tokenHash, familyId } = this.generateRefreshToken();

    const refreshExpiry = new Date();
    refreshExpiry.setSeconds(refreshExpiry.getSeconds() + this.refreshTtlSeconds());

    const csrfToken = randomBytes(32).toString('hex');

    await this.db.transaction(async (tx) => {
      await this.sessionRepo.create(
        {
          id: sessionId,
          workspaceId: ssoWorkspaceId,
          userId: user.id,
          tokenHash,
          familyId,
          ipAddress,
          expiresAt: refreshExpiry,
          ssoProvider: 'entra',
          csrfToken,
        },
        tx,
      );
      await this.userRepo.updateLastLogin(user.id, tx);
    });

    this.logger.log(
      { userId: user.id, jti, sessionId, provider: 'entra' },
      'User logged in via SSO',
    );

    void this.audit.record({
      workspaceId: ssoWorkspaceId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login.sso',
      resourceType: 'session',
      resourceId: sessionId,
      ipAddress,
      metadata: { provider: 'entra', oid },
    });

    const memberships = await this.workspaceService.getMemberships(user.id);
    void this.workspaceService.touchMembership(user.id, ssoWorkspaceId);

    return {
      accessToken,
      refreshToken,
      expiresIn,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        timezone: user.timezone,
      },
      memberships,
    };
  }

  /**
   * Resolve which Rally workspace a federated (SSO) user belongs to and provision
   * them if needed. Resolution is driven entirely by the SSO connection:
   *
   *   1. SSO connection by Entra tid → provision into the mapped workspace, subject
   *                                    to the connection's domain allow-list and
   *                                    JIT toggle. This is the primary mechanism.
   *   2. Otherwise                   → 403; the user must be invited by an admin.
   *
   * An unmapped IdP is rejected rather than silently dropped into a default
   * workspace — so a directory the operator hasn't explicitly mapped can't leak in.
   */
  private async resolveAndProvisionSsoUser(input: {
    oid: string;
    email: string;
    displayName: string;
    externalTenantId: string | null;
  }): Promise<{ user: User; workspaceId: string }> {
    const { oid, email, displayName, externalTenantId } = input;

    // Determine the Rally workspaceId from the SSO connection first, so we always
    // have an explicit workspace regardless of whether the user pre-exists.
    let connectionWorkspaceId: string | null = null;
    let defaultRoleSlug: string | undefined;

    if (externalTenantId) {
      const connection = await this.ssoConnectionRepo.findByExternalTenantId(
        'entra',
        externalTenantId,
      );
      if (connection) {
        if (connection.status !== 'active') {
          throw new UnauthorizedException(
            'SSO_CONNECTION_DISABLED',
            'SSO for your organization is disabled. Please contact your administrator.',
          );
        }
        if (!this.isEmailDomainAllowed(email, connection.allowedEmailDomains)) {
          throw new UnauthorizedException(
            'SSO_DOMAIN_NOT_ALLOWED',
            'Your email domain is not permitted to sign in to this organization.',
          );
        }
        if (!connection.jitEnabled) {
          throw new UnauthorizedException(
            'SSO_JIT_DISABLED',
            'Automatic account creation is disabled. Please ask your administrator for an invitation.',
          );
        }
        connectionWorkspaceId = connection.workspaceId;
        defaultRoleSlug = connection.defaultRoleSlug;
      }
    }

    if (!connectionWorkspaceId) {
      throw new UnauthorizedException(
        'SSO_NO_ACCESS',
        'No Rally workspace is configured for your organization. Please ask your administrator for an invitation.',
      );
    }

    const workspaceId = connectionWorkspaceId;

    // Upsert the user + SSO identity link. The SSO identity is install-global;
    // workspace membership is handled separately below.
    const user = await this.userRepo.upsertBySsoIdentity('entra', oid, email, displayName);

    // Ensure the user is an active member of the SSO connection's workspace.
    await this.workspaceService.enrollMember(workspaceId, user.id);

    if (defaultRoleSlug) {
      await this.accessService.ensureDefaultRole(user.id, workspaceId, defaultRoleSlug);
    }

    return { user, workspaceId };
  }

  /** Returns true when the email's domain is permitted (empty list = any). */
  private isEmailDomainAllowed(email: string, allowedDomains: string[]): boolean {
    if (!allowedDomains || allowedDomains.length === 0) return true;
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    return allowedDomains.some((d) => d.toLowerCase().trim() === domain);
  }

  // ---------------------------------------------------------------------------
  // Get current user
  // ---------------------------------------------------------------------------

  async getMe(userId: string): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('USER_NOT_FOUND', 'User not found');
    }
    return user;
  }

  // ---------------------------------------------------------------------------
  // Change password
  // ---------------------------------------------------------------------------

  @Span('auth.changePassword')
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('USER_NOT_FOUND', 'User not found');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'AUTH_INVALID_CREDENTIALS',
        'No password set for this account',
      );
    }

    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new PreconditionFailedException(
        'AUTH_INVALID_CREDENTIALS',
        'Current password is incorrect',
      );
    }

    const newHash = await AuthService.hashPassword(newPassword);
    await this.userRepo.updatePasswordHash(userId, newHash);
    this.logger.log({ userId }, 'Password changed');
  }

  // ---------------------------------------------------------------------------
  // Update profile
  // ---------------------------------------------------------------------------

  async updateProfile(
    userId: string,
    input: { displayName?: string; avatarUrl?: string | null; locale?: string; timezone?: string },
  ): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('USER_NOT_FOUND', 'User not found');
    }
    return this.userRepo.updateProfile(userId, input);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private signAccessToken(
    user: User,
    sessionId: string,
    permissions: string[],
    workspaceId: string,
    authMethod: 'password' | 'sso' = 'password',
  ): { accessToken: string; jti: string; expiresIn: number } {
    const jti = uuidv7();
    // Keep the client-facing expiresIn in lock-step with the JWT signing config
    // (JWT_ACCESS_EXPIRY) so a config change can never desync the two.
    const expiresIn = parseDurationToSeconds(this.config.get('JWT_ACCESS_EXPIRY'));

    const payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: user.id,
      workspaceId,
      sessionId,
      jti,
      permissions,
      authMethod,
    };

    const accessToken = this.jwt.sign(payload);
    return { accessToken, jti, expiresIn };
  }

  private generateRefreshToken(): {
    refreshToken: string;
    tokenHash: string;
    familyId: string;
  } {
    const refreshToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(refreshToken);
    const familyId = uuidv7();
    return { refreshToken, tokenHash, familyId };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshTtlSeconds(): number {
    const expiry = this.config.get('JWT_REFRESH_EXPIRY'); // e.g. '30d'
    const match = /^(\d+)([smhd])$/.exec(expiry);
    if (!match) return REMEMBER_ME_TTL_SECONDS;
    const [, n, unit] = match;
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(n, 10) * (multipliers[unit] ?? 86400);
  }

  /** Hash a password with argon2id (use once, at user creation / password reset). */
  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  // ---------------------------------------------------------------------------
  // Logout all devices
  // ---------------------------------------------------------------------------

  @Span('auth.logoutAll')
  async logoutAll(payload: JwtPayload): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(payload.exp - now, 0);

    await Promise.all([
      ttl > 0 ? this.valkey.denylistToken(payload.jti, ttl) : Promise.resolve(),
      this.sessionRepo.revokeAllForUser(payload.sub),
    ]);

    this.logger.log({ userId: payload.sub }, 'User logged out from all devices');
  }

  // ---------------------------------------------------------------------------
  // Forgot password
  // ---------------------------------------------------------------------------

  @Span('auth.forgotPassword')
  async forgotPassword(email: string): Promise<{ devResetUrl?: string }> {
    // Always return success to prevent user enumeration (AUTH-FR-007)
    const user = await this.userRepo.findByEmail(email.toLowerCase().trim());
    if (!user || user.deletedAt || user.status !== 'active') {
      return {}; // silent no-op
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const ttlHours = this.config.get('PASSWORD_RESET_TOKEN_TTL_HOURS');
    const expiresAt = addHours(ttlHours);

    const baseUrl = this.config.get('APP_BASE_URL');
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    // Atomic: persist the reset token and enqueue the email in the SAME
    // transaction. Either both commit or neither does — we never end up with a
    // token the user can't act on, or an email pointing at a non-existent token.
    // The worker EmailRelayService dispatches it asynchronously, so the HTTP
    // response returns immediately regardless of SES availability.
    //
    // idempotencyKey: derived from tokenHash so a retry of the *same* HTTP
    // request (network blip) won't schedule a second email for the same token.
    // A new forgot-password submit generates a new token → new hash → new key,
    // which is intentional (user requested a fresh token).
    const emailKey = this.hashToken(`password-reset:${tokenHash}`);
    await this.db.transaction(async (tx) => {
      await this.userRepo.createPasswordResetToken(user.id, tokenHash, expiresAt, tx);
      await this.emailScheduler.schedule(
        {
          to: user.email,
          template: 'password-reset',
          vars: {
            resetUrl,
            expiresInHours: String(ttlHours),
            recipientEmail: user.email,
          },
          idempotencyKey: emailKey,
        },
        tx,
      );
    });

    // In development only: surface the reset URL so developers can test the flow
    // without a real email provider (AUTH-FR-007 still holds — email is not leaked)
    if (this.config.get('NODE_ENV') === 'development') {
      return { devResetUrl: resetUrl };
    }
    return {};
  }

  // ---------------------------------------------------------------------------
  // Verify reset token (read-only — does not consume the token)
  // Enterprise: lets the reset-password page validate the link before the user
  // fills in the form, surfacing "expired" / "invalid" states early.
  // ---------------------------------------------------------------------------

  @Span('auth.verifyResetToken')
  async verifyResetToken(
    rawToken: string,
  ): Promise<{ valid: true } | { valid: false; reason: 'invalid' | 'expired' | 'used' }> {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.userRepo.findPasswordResetToken(tokenHash);

    if (!record) return { valid: false, reason: 'invalid' };
    if (record.usedAt !== null) return { valid: false, reason: 'used' };
    if (record.expiresAt < new Date()) return { valid: false, reason: 'expired' };

    return { valid: true };
  }

  // ---------------------------------------------------------------------------
  // Reset password
  // ---------------------------------------------------------------------------

  @Span('auth.resetPassword')
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.userRepo.findPasswordResetToken(tokenHash);

    if (!record) {
      throw new UnauthorizedException(
        'PASSWORD_RESET_TOKEN_INVALID',
        'Invalid or unknown reset token',
      );
    }

    if (record.usedAt !== null) {
      throw new UnauthorizedException(
        'PASSWORD_RESET_TOKEN_INVALID',
        'Reset token has already been used',
      );
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('PASSWORD_RESET_TOKEN_EXPIRED', 'Reset token has expired');
    }

    const user = await this.userRepo.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException(
        'PASSWORD_RESET_TOKEN_INVALID',
        'Invalid or unknown reset token',
      );
    }

    const newHash = await AuthService.hashPassword(newPassword);

    // Atomic: update password, consume the token, and revoke every active
    // session together. A partial failure here would otherwise leave old
    // refresh tokens valid after a password reset (session-hijacking gap).
    // Uses a superuser (RLS-bypassing) transaction so sessions are revoked
    // across ALL workspaces, not just the user's most-recent active workspace.
    await this.db.transaction(async (tx) => {
      await this.userRepo.updatePasswordHash(record.userId, newHash, tx);
      await this.userRepo.markPasswordResetTokenUsed(record.id, tx);
      await this.sessionRepo.revokeAllForUser(record.userId, tx); // AUTH-FR-009
    });

    this.logger.log({ userId: record.userId }, 'Password reset successfully');
  }

  // ---------------------------------------------------------------------------
  // Switch workspace
  // ---------------------------------------------------------------------------

  @Span('auth.switchWorkspace')
  async switchWorkspace(
    payload: JwtPayload,
    targetWorkspaceId: string,
    ipAddress?: string,
  ): Promise<RefreshResult> {
    // Verify the caller has an active membership for the target workspace.
    const keycard = await this.workspaceService.getMembership(payload.sub, targetWorkspaceId);
    if (!keycard || keycard.status !== 'active') {
      throw new UnauthorizedException(
        'WORKSPACE_ACCESS_DENIED',
        'You are not a member of this workspace',
      );
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user || user.deletedAt || user.status === 'suspended' || user.status === 'inactive') {
      throw new UnauthorizedException('USER_DEACTIVATED', 'User not found or deactivated');
    }

    const { permissions } = await this.accessService.getUserRoleAndPermissions(
      user.id,
      targetWorkspaceId,
    );

    const newSessionId = uuidv7();
    // Preserve authMethod across workspace switches
    const switchAuthMethod: 'password' | 'sso' = payload.authMethod ?? 'password';
    const { accessToken, jti, expiresIn } = this.signAccessToken(
      user,
      newSessionId,
      permissions,
      targetWorkspaceId,
      switchAuthMethod,
    );
    const { refreshToken, tokenHash, familyId } = this.generateRefreshToken();

    const refreshExpiry = new Date();
    refreshExpiry.setSeconds(refreshExpiry.getSeconds() + this.refreshTtlSeconds());

    const csrfToken = randomBytes(32).toString('hex');

    // Denylist old access token + revoke old session + create new session atomically.
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max((payload.exp ?? 0) - now, 0);

    await Promise.all([
      ttl > 0 ? this.valkey.denylistToken(payload.jti, ttl) : Promise.resolve(),
      this.db.transaction(async (tx) => {
        await this.sessionRepo.revokeById(payload.sessionId, tx);
        await this.sessionRepo.create(
          {
            id: newSessionId,
            workspaceId: targetWorkspaceId,
            userId: user.id,
            tokenHash,
            familyId,
            ipAddress,
            expiresAt: refreshExpiry,
            csrfToken,
          },
          tx,
        );
      }),
    ]);

    this.logger.log(
      { userId: user.id, jti, sessionId: newSessionId, targetWorkspaceId },
      'Workspace switched',
    );

    void this.workspaceService.touchMembership(user.id, targetWorkspaceId);
    void this.audit.record({
      workspaceId: targetWorkspaceId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.switch_workspace',
      resourceType: 'session',
      resourceId: newSessionId,
      ipAddress,
      metadata: { fromWorkspaceId: payload.workspaceId, toWorkspaceId: targetWorkspaceId },
    });

    return { accessToken, refreshToken, expiresIn, csrfToken };
  }
}
