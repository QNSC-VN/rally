import type { DbExecutor } from '@platform';

export const USER_ACCESS_REVOKER = Symbol('USER_ACCESS_REVOKER');

/**
 * Ending a person's access is an IDENTITY action, and disabling their membership is a WORKSPACE
 * action. This is the seam between the two.
 *
 * WHY A PORT AND NOT A DIRECT CALL
 * `IdentityModule` imports `WorkspaceModule` (it binds `WorkspaceService` as its `WORKSPACE_SERVICE`
 * port), so the reverse import would be a module cycle. The direction is therefore the mirror image
 * of how identity consumes workspace: workspace DECLARES the port, identity IMPLEMENTS it and binds
 * it under this token. `IdentityModule` is `@Global` and exports the token, so `WorkspaceService`
 * resolves it with no import of its own.
 *
 * WHY THIS EXISTS AT ALL
 * `WorkspaceService.updateMember` / `removeMember` wrote `workspace_members.status` and called only
 * `AccessService.invalidateUser`, which drops the cached PERMISSION resolution. That leaves the
 * session intact: the suspended member keeps a valid access token and a live refresh session, and
 * lands in the shell with zero effective permissions — which is not "denied access".
 *   • `Phase 0/02_Authentication/SRS.md:64`  AUTH-SSO-006 — "Inactive/suspended users are denied
 *     access even when identity-provider authentication succeeds."
 *   • `:81`  AUTH-FR-013 — "Tài khoản suspended/inactive không được refresh session."
 *   • `Phase 0/03_Workspace/SRS.md:307`  AC-5 — "Disabled/removed user mất company access ở lần
 *     refresh tiếp theo qua cả UI và direct API."
 */
export interface IUserAccessRevoker {
  /**
   * End every live session for the user, in BOTH directions a session can survive:
   * the refresh sessions in the database, and the per-user access-token denylist that
   * `JwtAuthGuard` checks on every request (Bearer AND BFF-cookie paths alike).
   *
   * Call AFTER the transaction commits, like `AccessService.invalidateUser` — a revocation
   * whose membership write then rolls back would log someone out for nothing.
   */
  revokeAllSessions(userId: string): Promise<void>;

  /**
   * Clear the per-user access-token denylist, so a REINSTATED member can sign back in.
   *
   * Without this the key would stand for its full TTL (`JWT_ACCESS_EXPIRY`) and a freshly issued
   * token would keep being rejected — a member reactivated a minute after suspension would appear
   * to be locked out with nothing on screen to explain it.
   */
  restoreSessions(userId: string): Promise<void>;

  /**
   * Write the ACCOUNT-level status (`identity.users.status`) — the gate every login path reads.
   *
   * Separate from the session revocation above because it answers a different question: revocation
   * ends the session the member HAS, this decides whether they may obtain a new one. Takes a `tx`
   * so it commits or rolls back with the membership write it accompanies.
   */
  setAccountStatus(userId: string, status: 'active' | 'suspended', tx?: DbExecutor): Promise<void>;
}
