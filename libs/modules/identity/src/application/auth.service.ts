import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { uuidv7 } from 'uuidv7';
import {
  AppConfigService,
  ValkeyService,
  UnauthorizedException,
  NotFoundException,
  Span,
  parseDurationToSeconds,
  InjectDrizzle,
} from '@platform';
import type { JwtPayload, DrizzleDB } from '@platform';
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
    private readonly accessService: AccessService,
    private readonly workspaceService: WorkspaceService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  @Span('auth.refresh')
  async refresh(
    rawRefreshToken: string,
    csrfToken: string | null,
    ipAddress?: string,
  ): Promise<RefreshResult> {
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
        // Identity exists but the user has no workspace membership (e.g. a prior
        // partial provision linked the SSO identity without enrolling the user).
        // Re-run JIT provisioning via the SSO connection to self-heal rather than
        // hard-failing — resolveAndProvisionSsoUser is idempotent (it upserts the
        // identity and enrolls only if no membership exists) and still enforces
        // the connection's active/domain/JIT guards.
        const reprovisioned = await this.resolveAndProvisionSsoUser({
          oid,
          email: normalizedEmail,
          displayName,
          externalTenantId,
        });
        user = reprovisioned.user;
        ssoWorkspaceId = reprovisioned.workspaceId;
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

  // ---------------------------------------------------------------------------
  // Dev login — passwordless, non-production only (local development + E2E)
  // ---------------------------------------------------------------------------

  /**
   * Sign in a seeded account by email with no password or IdP round-trip.
   *
   * Rally is SSO-only in production; this exists purely so local development and
   * the Playwright E2E suite can authenticate without a real Entra tenant. It is
   * hard-blocked when NODE_ENV is 'production' so it can never be used as a
   * password-less backdoor in a deployed environment.
   */
  @Span('auth.devLogin')
  async devLogin(email: string, ipAddress?: string): Promise<LoginResult> {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new UnauthorizedException('DEV_LOGIN_DISABLED', 'Dev login is disabled in production');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.userRepo.findByEmail(normalizedEmail);
    if (!user || user.deletedAt || user.status === 'suspended' || user.status === 'inactive') {
      throw new UnauthorizedException(
        'AUTH_INVALID_CREDENTIALS',
        'No active account exists for this email',
      );
    }

    const memberships = await this.workspaceService.getMemberships(user.id);
    const workspaceId = memberships[0]?.workspaceId;
    if (!workspaceId) {
      throw new UnauthorizedException(
        'ACCOUNT_DEACTIVATED',
        'No active workspace membership found',
      );
    }

    const sessionId = uuidv7();
    const { permissions } = await this.accessService.getUserRoleAndPermissions(
      user.id,
      workspaceId,
    );
    // authMethod 'password' (not SSO) so the SPA uses plain cookie-based refresh
    // instead of an MSAL silent re-auth for these local sessions.
    const { accessToken, jti, expiresIn } = this.signAccessToken(
      user,
      sessionId,
      permissions,
      workspaceId,
      'password',
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

    this.logger.log({ userId: user.id, jti, sessionId }, 'User logged in via dev-login');

    void this.audit.record({
      workspaceId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login.dev',
      resourceType: 'session',
      resourceId: sessionId,
      ipAddress,
      metadata: { method: 'dev-login' },
    });

    void this.workspaceService.touchMembership(user.id, workspaceId);

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
