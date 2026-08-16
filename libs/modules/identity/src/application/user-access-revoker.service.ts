import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuthTokenCache,
  AUTH_SESSION_REPOSITORY,
  USER_REPOSITORY,
  type IAuthSessionRepository,
  type IUserRepository,
} from '@qnsc-vn/identity';
import { AppConfigService, parseDurationToSeconds } from '@platform';
import type { DbExecutor } from '@platform';
import type { IUserAccessRevoker } from '@modules/workspace/domain/ports/user-access.revoker';

/**
 * Ends a person's access when an administrator suspends or removes them.
 *
 * This is the identity-side implementation of {@link IUserAccessRevoker}, a port DECLARED in
 * `libs/modules/workspace` — the direction is forced (`IdentityModule` already imports
 * `WorkspaceModule` to bind `WORKSPACE_SERVICE`, so the reverse import would be a cycle) and it is
 * also the right one: revoking a session is this module's business, deciding that a member should
 * lose access is the workspace module's.
 *
 * IT INVENTS NOTHING. Both mechanisms already existed and are the same two `logout` and `logoutAll`
 * use; nothing in rally had ever called the per-USER half:
 *
 *   • `IAuthSessionRepository.revokeAllForUser` — the DB half, exactly as `AuthService.logoutAll`
 *     uses it. Kills every refresh session, so the next refresh (and therefore the next BFF session
 *     refresh) fails: AUTH-FR-013.
 *   • `AuthTokenCache.revokeUser` — the cache half. `logout`/`logoutAll` denylist ONE `jti`, which
 *     only the token's own holder knows; an administrator suspending somebody else has no jti to
 *     denylist, which is precisely why the package ships a per-USER key and documents it as "used
 *     when an admin suspends / deactivates a user account". `JwtAuthGuard.enforceDenylist` reads it
 *     on EVERY authenticated request, on the Bearer path and the BFF-cookie path alike, so one write
 *     ends both. Its own docblock already named "the per-user (offboarding) denylist" as something
 *     it enforces — the write side was the missing half.
 *
 * The cache key's TTL is `JWT_ACCESS_EXPIRY`, the longest an already-issued access token can still
 * be presented. Past that there is nothing left to deny: every surviving credential has to come
 * from a refresh (revoked above) or a fresh login (see `setAccountStatus`).
 */
@Injectable()
export class UserAccessRevokerService implements IUserAccessRevoker {
  private readonly logger = new Logger(UserAccessRevokerService.name);

  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessionRepo: IAuthSessionRepository<DbExecutor>,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository<DbExecutor>,
    private readonly authCache: AuthTokenCache,
    private readonly config: AppConfigService,
  ) {}

  async revokeAllSessions(userId: string): Promise<void> {
    const ttlSeconds = parseDurationToSeconds(this.config.get('JWT_ACCESS_EXPIRY'));
    await Promise.all([
      this.sessionRepo.revokeAllForUser(userId),
      this.authCache.revokeUser(userId, ttlSeconds),
    ]);
    this.logger.log({ userId, ttlSeconds }, 'All sessions revoked for user');
  }

  async restoreSessions(userId: string): Promise<void> {
    // Only the cache key is cleared. The revoked refresh sessions stay revoked deliberately: a
    // reinstated member logs in again and gets a new session, which is the same thing every other
    // revocation in this system means. Reviving old sessions would resurrect credentials that were
    // in a suspended member's hands.
    await this.authCache.unrevokeUser(userId);
    this.logger.log({ userId }, 'User-level token revocation cleared');
  }

  async setAccountStatus(
    userId: string,
    status: 'active' | 'suspended',
    tx?: DbExecutor,
  ): Promise<void> {
    await this.userRepo.updateStatus(userId, status, tx);
  }
}
