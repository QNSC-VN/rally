import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, ConflictException } from '@platform';
import type { JwtPayload } from '@platform';
import { IRoleRepository, ROLE_REPOSITORY } from '../domain/ports/role.repository';
import {
  IRoleAssignmentRepository,
  ROLE_ASSIGNMENT_REPOSITORY,
} from '../domain/ports/role-assignment.repository';
import type {
  SystemRole,
  UserRoleAssignment,
  ScopeType,
  AssignRoleInput,
} from '../domain/access.types';

@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(ROLE_ASSIGNMENT_REPOSITORY)
    private readonly assignmentRepo: IRoleAssignmentRepository,
  ) {}

  // ── Roles ─────────────────────────────────────────────────────────────────

  async listRoles(tenantId: string): Promise<SystemRole[]> {
    return this.roleRepo.listForTenant(tenantId);
  }

  // ── Assignments ───────────────────────────────────────────────────────────

  async getUserAssignments(tenantId: string, userId: string): Promise<UserRoleAssignment[]> {
    return this.assignmentRepo.listForUser(tenantId, userId);
  }

  async assignRole(
    actor: JwtPayload,
    userId: string,
    roleId: string,
    scopeType: ScopeType,
    scopeId?: string,
  ): Promise<UserRoleAssignment> {
    // Validate role exists and is accessible for this tenant
    const role = await this.roleRepo.findById(roleId);
    if (!role || (role.tenantId !== null && role.tenantId !== actor.tenantId)) {
      throw new NotFoundException('ROLE_NOT_FOUND', 'Role not found');
    }

    const existing = await this.assignmentRepo.findExisting(
      userId,
      roleId,
      scopeType,
      scopeId ?? null,
    );
    if (existing) {
      throw new ConflictException(
        'ROLE_ASSIGNMENT_NOT_FOUND',
        'User already has this role in the given scope',
      );
    }

    const input: AssignRoleInput = {
      id: uuidv7(),
      tenantId: actor.tenantId,
      userId,
      roleId,
      scopeType,
      scopeId,
      grantedBy: actor.sub,
    };

    const assignment = await this.assignmentRepo.create(input);
    this.logger.log(
      { assignmentId: assignment.id, userId, roleId, scopeType, scopeId },
      'Role assigned',
    );
    return assignment;
  }

  async revokeRole(actor: JwtPayload, assignmentId: string): Promise<void> {
    const assignment = await this.assignmentRepo.findById(assignmentId);
    if (!assignment || assignment.tenantId !== actor.tenantId) {
      throw new NotFoundException('ROLE_ASSIGNMENT_NOT_FOUND', 'Role assignment not found');
    }
    await this.assignmentRepo.delete(assignmentId);
    this.logger.log({ assignmentId, revokedBy: actor.sub }, 'Role revoked');
  }

  /** Check if a user has a specific permission in any scope. Used by guards. */
  async hasPermission(tenantId: string, userId: string, permission: string): Promise<boolean> {
    const assignments = await this.assignmentRepo.listForUser(tenantId, userId);
    if (!assignments.length) return false;

    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    for (const roleId of roleIds) {
      const role = await this.roleRepo.findById(roleId);
      if (role?.permissions.includes(permission)) return true;
    }
    return false;
  }

  /**
   * Resolve the primary role + effective permissions for a user.
   * Workspace-scoped assignments take precedence over tenant/project scope.
   * Falls back to 'workspace_member' defaults when the user has no assignments.
   */
  /**
   * Ensures a JIT-provisioned user has at least the default workspace role.
   * Called after SSO creates a new user — no actor needed (system operation).
   * Idempotent: does nothing if the user already has an assignment.
   */
  async ensureDefaultRole(
    userId: string,
    tenantId: string,
    defaultRoleSlug = 'project_member',
  ): Promise<void> {
    const existing = await this.assignmentRepo.listForUser(tenantId, userId)
    if (existing.length > 0) return // already has a role

    const roles = await this.roleRepo.listForTenant(tenantId)
    const defaultRole = roles.find((r) => r.slug === defaultRoleSlug) ?? roles.find((r) => r.slug === 'workspace_member')
    if (!defaultRole) {
      this.logger.warn({ userId, tenantId }, 'No default role found for JIT-provisioned user')
      return
    }

    const input: AssignRoleInput = {
      id: uuidv7(),
      tenantId,
      userId,
      roleId: defaultRole.id,
      scopeType: 'workspace',
      scopeId: undefined,
      grantedBy: userId, // self-assigned by system on JIT provision
    }
    await this.assignmentRepo.create(input)
    this.logger.log({ userId, roleSlug: defaultRole.slug }, 'Default role assigned to JIT-provisioned SSO user')
  }

  async getUserRoleAndPermissions(
    userId: string,
    tenantId: string,
  ): Promise<{ role: string; permissions: string[] }> {
    const assignments = await this.assignmentRepo.listForUser(tenantId, userId);
    if (!assignments.length) {
      return { role: 'workspace_member', permissions: ['workspace:view', 'project:view'] };
    }

    // Prefer workspace-scope assignment (most representative of the user's primary role)
    const preferred = assignments.find((a) => a.scopeType === 'workspace') ?? assignments[0];

    const role = await this.roleRepo.findById(preferred.roleId);
    return {
      role: role?.slug ?? 'workspace_member',
      permissions: role?.permissions ?? ['workspace:view', 'project:view'],
    };
  }
}
