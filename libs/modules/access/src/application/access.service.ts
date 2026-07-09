import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, ConflictException, PermissionDeniedException } from '@platform';
import { SYSTEM_ROLE, PERMISSION, permissionGrants, type Permission } from '@shared-kernel';
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

  async listRoles(workspaceId: string): Promise<SystemRole[]> {
    return this.roleRepo.listForWorkspace(workspaceId);
  }

  // ── Assignments ───────────────────────────────────────────────────────────

  async getUserAssignments(workspaceId: string, userId: string): Promise<UserRoleAssignment[]> {
    return this.assignmentRepo.listForUser(workspaceId, userId);
  }

  async assignRole(
    actor: JwtPayload,
    userId: string,
    roleId: string,
    scopeType: ScopeType,
    scopeId?: string,
  ): Promise<UserRoleAssignment> {
    // Validate role exists and is accessible for this workspace
    const role = await this.roleRepo.findById(roleId);
    if (!role || (role.workspaceId !== null && role.workspaceId !== actor.workspaceId)) {
      throw new NotFoundException('ROLE_NOT_FOUND', 'Role not found');
    }

    const existing = await this.assignmentRepo.findExisting(
      userId,
      roleId,
      scopeType,
      scopeId ?? null,
      actor.workspaceId,
    );
    if (existing) {
      throw new ConflictException(
        'ROLE_ASSIGNMENT_NOT_FOUND',
        'User already has this role in the given scope',
      );
    }

    const input: AssignRoleInput = {
      id: uuidv7(),
      workspaceId: actor.workspaceId,
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
    const assignment = await this.assignmentRepo.findById(assignmentId, actor.workspaceId);
    if (!assignment) {
      throw new NotFoundException('ROLE_ASSIGNMENT_NOT_FOUND', 'Role assignment not found');
    }
    await this.assignmentRepo.delete(assignmentId);
    this.logger.log({ assignmentId, revokedBy: actor.sub }, 'Role revoked');
  }

  /** Check if a user has a specific permission in any scope. Used by guards.
   * Wildcard expansion: `workspace:*` matches any `workspace:<action>`.
   * NOTE: assumes 2-segment permission strings (namespace:action). If 3-segment
   * permissions are added in future, expand this to check prefix wildcards at
   * each segment boundary (e.g. `workspace:admin:*` matches `workspace:admin:write`).
   */
  async hasPermission(workspaceId: string, userId: string, permission: string): Promise<boolean> {
    const assignments = await this.assignmentRepo.listForUser(workspaceId, userId);
    if (!assignments.length) return false;

    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    for (const roleId of roleIds) {
      const role = await this.roleRepo.findById(roleId);
      const [reqNs] = permission.split(':');
      if (role?.permissions.includes(`${reqNs}:*`)) return true;
      if (role?.permissions.includes(permission)) return true;
    }
    return false;
  }

  /**
   * Resolve the primary role + effective permissions for a user.
   * Workspace-scoped assignments take precedence over workspace/project scope.
   * Falls back to 'workspace_member' defaults when the user has no assignments.
   */
  /**
   * Ensures a JIT-provisioned user has at least the default workspace role.
   * Called after SSO creates a new user — no actor needed (system operation).
   * Idempotent: does nothing if the user already has an assignment.
   */
  async ensureDefaultRole(
    userId: string,
    workspaceId: string,
    defaultRoleSlug: string = SYSTEM_ROLE.PROJECT_MEMBER,
  ): Promise<void> {
    const existing = await this.assignmentRepo.listForUser(workspaceId, userId)
    if (existing.length > 0) return // already has a role

    const roles = await this.roleRepo.listForWorkspace(workspaceId)
    const defaultRole = roles.find((r) => r.slug === defaultRoleSlug) ?? roles.find((r) => r.slug === SYSTEM_ROLE.WORKSPACE_MEMBER)
    if (!defaultRole) {
      this.logger.warn({ userId, workspaceId }, 'No default role found for JIT-provisioned user')
      return
    }

    const input: AssignRoleInput = {
      id: uuidv7(),
      workspaceId,
      userId,
      roleId: defaultRole.id,
      scopeType: 'workspace',
      scopeId: undefined,
      grantedBy: userId, // self-assigned by system on JIT provision
    }
    await this.assignmentRepo.create(input)
    this.logger.log({ userId, roleSlug: defaultRole.slug }, 'Default role assigned to JIT-provisioned SSO user')
  }

  /**
   * Forcibly assigns workspace_admin to a PLATFORM_ADMIN_EMAILS user.
   * Replaces any existing role assignment for the user in this workspace.
   * Idempotent: skips if workspace_admin is already assigned.
   */
  async elevateToWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const roles = await this.roleRepo.listForWorkspace(workspaceId)
    const adminRole = roles.find((r) => r.slug === SYSTEM_ROLE.WORKSPACE_ADMIN)
    if (!adminRole) {
      this.logger.warn({ userId, workspaceId }, 'workspace_admin role not found — cannot elevate')
      return false
    }

    const existing = await this.assignmentRepo.listForUser(workspaceId, userId)
    const alreadyAdmin = existing.some((a) => a.roleId === adminRole.id)
    if (alreadyAdmin) return false

    // Revoke workspace-scoped assignments only — preserve project-level roles.
    // workspace_admin has workspace:* so it supersedes them functionally,
    // but keeping project assignments means a manual downgrade restores them.
    for (const assignment of existing.filter((a) => a.scopeType === 'workspace')) {
      await this.assignmentRepo.delete(assignment.id)
    }

    await this.assignmentRepo.create({
      id: uuidv7(),
      workspaceId,
      userId,
      roleId: adminRole.id,
      scopeType: 'workspace',
      scopeId: undefined,
      grantedBy: userId,
    })
    this.logger.log({ userId }, 'User elevated to workspace_admin via PLATFORM_ADMIN_EMAILS')
    return true
  }

  /**
   * The user's BASELINE permissions — the union of every global- and
   * workspace-scoped role they hold in this workspace. This is what gets embedded
   * in the JWT: it's workspace-wide and stable for the token's lifetime.
   *
   * Project-scoped assignments are deliberately NOT included here — they're
   * resolved per-request by getProjectPermissions() so the token stays small
   * and per-project grants take effect immediately (no wait for token expiry).
   *
   * `role` is the single most-representative role slug (highest baseline scope),
   * kept for display / audit; authorization decisions use `permissions`.
   */
  async getUserRoleAndPermissions(
    userId: string,
    workspaceId: string,
  ): Promise<{ role: string; permissions: string[] }> {
    const assignments = await this.assignmentRepo.listForUser(workspaceId, userId);
    const baseline = assignments.filter(
      (a) => a.scopeType === 'global' || a.scopeType === 'workspace',
    );

    if (!baseline.length) {
      return {
        role: SYSTEM_ROLE.WORKSPACE_MEMBER,
        permissions: [PERMISSION.WORKSPACE_VIEW, PERMISSION.PROJECT_VIEW],
      };
    }

    const roles = await Promise.all(baseline.map((a) => this.roleRepo.findById(a.roleId)));
    const permissions = [
      ...new Set(roles.flatMap((r) => r?.permissions ?? [])),
    ];

    // Representative role: prefer a global assignment, else workspace.
    const primaryAssignment =
      baseline.find((a) => a.scopeType === 'global') ?? baseline[0];
    const primaryRole = roles[baseline.indexOf(primaryAssignment)];

    return {
      role: primaryRole?.slug ?? SYSTEM_ROLE.WORKSPACE_MEMBER,
      permissions,
    };
  }

  /**
   * Effective permissions for a specific PROJECT: the user's workspace-wide
   * baseline (global + workspace) unioned with any role they hold that is
   * scoped to exactly this project. Used by ProjectPermissionGuard at request
   * time so "admin of Project X, viewer of Project Y" is actually enforced.
   */
  async getProjectPermissions(
    userId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<string[]> {
    const assignments = await this.assignmentRepo.listForUser(workspaceId, userId);
    const relevant = assignments.filter(
      (a) =>
        a.scopeType === 'global' ||
        a.scopeType === 'workspace' ||
        (a.scopeType === 'project' && a.scopeId === projectId),
    );

    const roles = await Promise.all(relevant.map((a) => this.roleRepo.findById(a.roleId)));
    return [...new Set(roles.flatMap((r) => r?.permissions ?? []))];
  }

  /**
   * Service-layer per-project check, for routes where the project id is only
   * known after loading a resource (e.g. updateRelease knows the release's
   * projectId, not from the URL). Throws PermissionDeniedException (403) when the
   * caller lacks `required` for `projectId`. Wildcards are honoured.
   *
   * Guard-based routes (projectId on the request) use @RequireProjectPermission
   * instead — don't double-check.
   */
  async assertProjectPermission(
    user: JwtPayload,
    projectId: string,
    required: Permission,
  ): Promise<void> {
    // Fast path: a workspace-wide grant in the JWT covers every project.
    if (permissionGrants(user.permissions, required)) return;

    const effective = await this.getProjectPermissions(user.sub, user.workspaceId, projectId);
    if (permissionGrants(effective, required)) return;

    throw new PermissionDeniedException(
      'PROJECT_PERMISSION_DENIED',
      'You do not have permission to perform this action on this project',
    );
  }

  /** Wildcard-aware membership check: workspace:* / ns:* / exact match. */
}
