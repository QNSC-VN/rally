import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PermissionDeniedException,
  UnitOfWork,
  AuditProducer,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
} from '@platform';
import {
  SYSTEM_ROLE,
  PERMISSION,
  permissionGrants,
  isProjectTierPermission,
  type ProjectPermission,
} from '@shared-kernel';
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
    private readonly uow: UnitOfWork,
    private readonly audit: AuditProducer,
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

    const assignment = await this.uow.run(async (tx) => {
      const created = await this.assignmentRepo.create(input, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.ROLE_ASSIGNED,
          resourceType: AUDIT_RESOURCE.ROLE_ASSIGNMENT,
          resourceId: created.id,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          ...(scopeType === 'project' && scopeId ? { projectId: scopeId } : {}),
          changes: { after: { userId, roleId, scopeType, scopeId: scopeId ?? null } },
        },
        tx,
      );
      return created;
    });
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
    await this.uow.run(async (tx) => {
      await this.assignmentRepo.delete(assignmentId, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.ROLE_REVOKED,
          resourceType: AUDIT_RESOURCE.ROLE_ASSIGNMENT,
          resourceId: assignmentId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          ...(assignment.scopeType === 'project' && assignment.scopeId
            ? { projectId: assignment.scopeId }
            : {}),
          changes: {
            before: {
              userId: assignment.userId,
              roleId: assignment.roleId,
              scopeType: assignment.scopeType,
              scopeId: assignment.scopeId,
            },
          },
        },
        tx,
      );
    });
    this.logger.log({ assignmentId, revokedBy: actor.sub }, 'Role revoked');
  }

  /**
   * Assign a role to a user scoped to a SINGLE project. This is the endpoint a
   * project admin (holding `project:manage_members` on that project) uses to
   * manage their own project's membership — distinct from workspace-wide
   * assignment which requires `workspace:manage_members`.
   *
   * Privilege-escalation guard: only roles whose permissions are ALL project-tier
   * may be granted here. A role carrying any workspace-tier permission (e.g.
   * workspace_admin's `workspace:*`) can only be granted by a workspace admin via
   * the workspace-scoped endpoint, so a project admin can never escalate a member
   * to workspace-wide power.
   */
  async assignProjectRole(
    actor: JwtPayload,
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<UserRoleAssignment> {
    const role = await this.roleRepo.findById(roleId);
    if (!role || (role.workspaceId !== null && role.workspaceId !== actor.workspaceId)) {
      throw new NotFoundException('ROLE_NOT_FOUND', 'Role not found');
    }

    if (!role.permissions.every((p) => isProjectTierPermission(p))) {
      throw new PermissionDeniedException(
        'CANNOT_GRANT_WORKSPACE_ROLE',
        'This role carries workspace-level permissions and cannot be granted at project scope',
      );
    }

    return this.assignRole(actor, userId, roleId, 'project', projectId);
  }

  /**
   * Revoke a PROJECT-scoped role assignment. Guards that the assignment is
   * actually scoped to `projectId` so a project admin can't revoke a user's
   * workspace-wide (or other project's) role through their project endpoint.
   */
  async revokeProjectRole(
    actor: JwtPayload,
    projectId: string,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await this.assignmentRepo.findById(assignmentId, actor.workspaceId);
    if (!assignment || assignment.scopeType !== 'project' || assignment.scopeId !== projectId) {
      throw new NotFoundException('ROLE_ASSIGNMENT_NOT_FOUND', 'Role assignment not found');
    }
    await this.uow.run(async (tx) => {
      await this.assignmentRepo.delete(assignmentId, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.ROLE_REVOKED,
          resourceType: AUDIT_RESOURCE.ROLE_ASSIGNMENT,
          resourceId: assignmentId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          projectId,
          changes: {
            before: {
              userId: assignment.userId,
              roleId: assignment.roleId,
              scopeType: assignment.scopeType,
              scopeId: assignment.scopeId,
            },
          },
        },
        tx,
      );
    });
    this.logger.log({ assignmentId, projectId, revokedBy: actor.sub }, 'Project role revoked');
  }

  /** Check if a user has a specific permission in any scope. Used by guards.
   * Wildcard expansion: `workspace:*` matches any `workspace:<action>`.
   * NOTE: assumes 2-segment permission strings (namespace:action). If 3-segment
   * permissions are added in future, expand this to check prefix wildcards at
   * each segment boundary (e.g. `workspace:admin:*` matches `workspace:admin:write`).
   */
  async hasPermission(workspaceId: string, userId: string, permission: string): Promise<boolean> {
    const effective = await this.assignmentRepo.listEffectiveForUser(workspaceId, userId);
    if (!effective.length) return false;

    const [reqNs] = permission.split(':');
    return effective.some(
      (a) => a.permissions.includes(`${reqNs}:*`) || a.permissions.includes(permission),
    );
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
    const existing = await this.assignmentRepo.listForUser(workspaceId, userId);
    if (existing.length > 0) return; // already has a role

    const roles = await this.roleRepo.listForWorkspace(workspaceId);
    const defaultRole =
      roles.find((r) => r.slug === defaultRoleSlug) ??
      roles.find((r) => r.slug === SYSTEM_ROLE.WORKSPACE_MEMBER);
    if (!defaultRole) {
      this.logger.warn({ userId, workspaceId }, 'No default role found for JIT-provisioned user');
      return;
    }

    const input: AssignRoleInput = {
      id: uuidv7(),
      workspaceId,
      userId,
      roleId: defaultRole.id,
      scopeType: 'workspace',
      scopeId: undefined,
      grantedBy: userId, // self-assigned by system on JIT provision
    };
    await this.assignmentRepo.create(input);
    this.logger.log(
      { userId, roleSlug: defaultRole.slug },
      'Default role assigned to JIT-provisioned SSO user',
    );
  }

  /**
   * Forcibly assigns workspace_admin to a PLATFORM_ADMIN_EMAILS user.
   * Replaces any existing role assignment for the user in this workspace.
   * Idempotent: skips if workspace_admin is already assigned.
   */
  async elevateToWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const roles = await this.roleRepo.listForWorkspace(workspaceId);
    const adminRole = roles.find((r) => r.slug === SYSTEM_ROLE.WORKSPACE_ADMIN);
    if (!adminRole) {
      this.logger.warn({ userId, workspaceId }, 'workspace_admin role not found — cannot elevate');
      return false;
    }

    const existing = await this.assignmentRepo.listForUser(workspaceId, userId);
    const alreadyAdmin = existing.some((a) => a.roleId === adminRole.id);
    if (alreadyAdmin) return false;

    // Revoke workspace-scoped assignments only — preserve project-level roles.
    // workspace_admin has workspace:* so it supersedes them functionally,
    // but keeping project assignments means a manual downgrade restores them.
    for (const assignment of existing.filter((a) => a.scopeType === 'workspace')) {
      await this.assignmentRepo.delete(assignment.id);
    }

    await this.assignmentRepo.create({
      id: uuidv7(),
      workspaceId,
      userId,
      roleId: adminRole.id,
      scopeType: 'workspace',
      scopeId: undefined,
      grantedBy: userId,
    });
    this.logger.log({ userId }, 'User elevated to workspace_admin via PLATFORM_ADMIN_EMAILS');
    return true;
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
    const effective = await this.assignmentRepo.listEffectiveForUser(workspaceId, userId);
    const baseline = effective.filter(
      (a) => a.scopeType === 'global' || a.scopeType === 'workspace',
    );

    if (!baseline.length) {
      return {
        role: SYSTEM_ROLE.WORKSPACE_MEMBER,
        permissions: [PERMISSION.WORKSPACE_VIEW, PERMISSION.PROJECT_VIEW],
      };
    }

    const permissions = [...new Set(baseline.flatMap((a) => a.permissions))];

    // Representative role: prefer a global assignment, else the first workspace one.
    const primary = baseline.find((a) => a.scopeType === 'global') ?? baseline[0];

    return {
      role: primary.roleSlug ?? SYSTEM_ROLE.WORKSPACE_MEMBER,
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
    const effective = await this.assignmentRepo.listEffectiveForUser(workspaceId, userId);
    const relevant = effective.filter(
      (a) =>
        a.scopeType === 'global' ||
        a.scopeType === 'workspace' ||
        (a.scopeType === 'project' && a.scopeId === projectId),
    );

    return [...new Set(relevant.flatMap((a) => a.permissions))];
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
    required: ProjectPermission,
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
