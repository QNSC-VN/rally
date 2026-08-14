import type { UserRoleAssignment, AssignRoleInput, EffectiveAssignment } from '../access.types';
import type { DbExecutor } from '@platform';

export const ROLE_ASSIGNMENT_REPOSITORY = Symbol('ROLE_ASSIGNMENT_REPOSITORY');

/**
 * `findExisting` and `listUserIdsForRole` were removed by ruling (2026-08-14) with custom-role CRUD
 * and `assignRole`: the first only ever de-duplicated an incoming grant, and the second only ever
 * fanned out cache invalidation after a role's permission set was EDITED. Neither has a caller now.
 *
 * `create` deliberately survives, with exactly one caller — `AccessService.elevateToWorkspaceAdmin`,
 * which grants the one canonical role from `PLATFORM_ADMIN_EMAILS` and takes no role id from a
 * request. `delete` survives because `revokeRole` does; see the Roles section of `AccessService`.
 */
export interface IRoleAssignmentRepository {
  findById(id: string, workspaceId: string): Promise<UserRoleAssignment | null>;
  listForUser(workspaceId: string, userId: string): Promise<UserRoleAssignment[]>;
  /**
   * All of a user's assignments in a workspace joined with each role's permission
   * set, in a single query. Used by permission resolution to avoid N+1 lookups.
   */
  listEffectiveForUser(workspaceId: string, userId: string): Promise<EffectiveAssignment[]>;
  create(input: AssignRoleInput, tx?: DbExecutor): Promise<UserRoleAssignment>;
  delete(id: string, tx?: DbExecutor): Promise<void>;
}
