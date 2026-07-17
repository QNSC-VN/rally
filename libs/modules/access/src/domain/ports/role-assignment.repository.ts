import type {
  UserRoleAssignment,
  AssignRoleInput,
  ScopeType,
  EffectiveAssignment,
} from '../access.types';
import type { DbExecutor } from '@platform';

export const ROLE_ASSIGNMENT_REPOSITORY = Symbol('ROLE_ASSIGNMENT_REPOSITORY');

export interface IRoleAssignmentRepository {
  findById(id: string, workspaceId: string): Promise<UserRoleAssignment | null>;
  findExisting(
    userId: string,
    roleId: string,
    scopeType: ScopeType,
    scopeId: string | null,
    workspaceId: string,
  ): Promise<UserRoleAssignment | null>;
  listForUser(workspaceId: string, userId: string): Promise<UserRoleAssignment[]>;
  /**
   * All of a user's assignments in a workspace joined with each role's permission
   * set, in a single query. Used by permission resolution to avoid N+1 lookups.
   */
  listEffectiveForUser(workspaceId: string, userId: string): Promise<EffectiveAssignment[]>;
  create(input: AssignRoleInput, tx?: DbExecutor): Promise<UserRoleAssignment>;
  delete(id: string, tx?: DbExecutor): Promise<void>;
}
