import type { UserRoleAssignment, AssignRoleInput, ScopeType } from '../access.types';

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
  create(input: AssignRoleInput): Promise<UserRoleAssignment>;
  delete(id: string): Promise<void>;
}
