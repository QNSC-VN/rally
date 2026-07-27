import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PermissionDeniedException,
  UnitOfWork,
  AuthzEpochService,
  AuditProducer,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
} from '@platform';
import {
  SYSTEM_ROLE,
  PERMISSION,
  PERMISSION_TIER,
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
    private readonly authzEpoch: AuthzEpochService,
  ) {}

  /**
   * Invalidate a user's already-minted access tokens after a change to their
   * BASELINE (global- or workspace-scoped) permissions.
   *
   * Project-scoped changes deliberately do NOT bump: those permissions are never
   * embedded in the token — `getProjectPermissions` resolves them from the
   * database per request — so a bump would force a pointless re-mint. See
   * {@link AuthzEpochService} and {@link getUserRoleAndPermissions}.
   *
   * Always called AFTER the transaction commits: bumping inside the transaction
   * would let a concurrent request re-mint from pre-commit state, and a
   * rolled-back write would leave a bump behind.
   */
  private async invalidateBaselineTokens(scopeType: ScopeType, userId: string): Promise<void> {
    if (scopeType === 'project') return;
    await this.authzEpoch.bump(userId);
  }

  // ── Roles ─────────────────────────────────────────────────────────────────

  async listRoles(workspaceId: string): Promise<SystemRole[]> {
    return this.roleRepo.listForWorkspace(workspaceId);
  }

  /**
   * The catalogue of concrete permissions that can be granted to a custom role,
   * with each code's scope tier. Sourced directly from the canonical PERMISSION
   * catalogue so the editable role matrix never drifts from the guards.
   * Wildcard codes (e.g. `workspace:*`) are excluded — they are reserved for
   * built-in system roles and are not individually assignable.
   */
  getPermissionCatalog(): { code: string; tier: 'workspace' | 'project' }[] {
    return Object.values(PERMISSION)
      .filter((code) => !code.endsWith(':*'))
      .map((code) => ({ code, tier: PERMISSION_TIER[code] }));
  }

  /**
   * Replace a custom role's permission set. System roles (`isSystem`) are
   * immutable — their permissions are seeded from the canonical catalogue and
   * must not drift. Global roles (workspaceId = null) are likewise off-limits to
   * a single workspace's admin. The incoming codes are validated at the DTO
   * boundary against the PERMISSION catalogue, deduplicated here, and the change
   * is written + audited in a single transaction.
   */
  async updateRolePermissions(
    actor: JwtPayload,
    roleId: string,
    permissions: string[],
  ): Promise<SystemRole> {
    const role = await this.roleRepo.findById(roleId);
    if (!role || (role.workspaceId !== null && role.workspaceId !== actor.workspaceId)) {
      throw new NotFoundException('ROLE_NOT_FOUND', 'Role not found');
    }
    if (role.isSystem || role.workspaceId === null) {
      throw new ConflictException('ROLE_IMMUTABLE', 'Built-in system roles cannot be edited');
    }
    this.assertGrantablePermissions(actor, permissions);

    const next = [...new Set(permissions)].sort();

    const updated = await this.uow.run(async (tx) => {
      const saved = await this.roleRepo.updatePermissions(roleId, next, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.ROLE_PERMISSIONS_UPDATED,
          resourceType: AUDIT_RESOURCE.ROLE,
          resourceId: roleId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          changes: { before: { permissions: role.permissions }, after: { permissions: next } },
        },
        tx,
      );
      return saved;
    });
    // A role's permission set changed, so every holder's token snapshot is stale.
    // Assignees are read after the commit so the list reflects the new state.
    const assignees = await this.assignmentRepo.listUserIdsForRole(roleId);
    await this.authzEpoch.bumpMany(assignees);

    this.logger.log(
      { roleId, updatedBy: actor.sub, invalidatedUsers: assignees.length },
      'Role permissions updated',
    );
    return updated;
  }

  /**
   * Create a workspace-owned custom role. Built-ins stay immutable; this is the
   * only way a workspace gains a new role. The permission set must be grantable
   * (see {@link assertGrantablePermissions}); the slug is derived from the name
   * and de-duplicated against the roles already visible to the workspace.
   */
  async createRole(
    actor: JwtPayload,
    input: { name: string; description?: string | null; permissions: string[] },
  ): Promise<SystemRole> {
    this.assertGrantablePermissions(actor, input.permissions);
    const permissions = [...new Set(input.permissions)].sort();
    const slug = await this.deriveUniqueSlug(actor.workspaceId, input.name);

    const created = await this.uow.run(async (tx) => {
      const saved = await this.roleRepo.create(
        {
          workspaceId: actor.workspaceId,
          name: input.name.trim(),
          slug,
          description: input.description?.trim() || null,
          permissions,
        },
        tx,
      );
      await this.audit.emit(
        {
          action: AUDIT_ACTION.ROLE_CREATED,
          resourceType: AUDIT_RESOURCE.ROLE,
          resourceId: saved.id,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          changes: { after: { name: saved.name, slug: saved.slug, permissions } },
        },
        tx,
      );
      return saved;
    });
    // A brand-new role has no holders yet — no token epoch bump needed.
    this.logger.log({ roleId: created.id, slug, createdBy: actor.sub }, 'Custom role created');
    return created;
  }

  /**
   * Delete a workspace-owned custom role. Built-ins are immutable; a role still
   * held by any user is blocked (409) so no one silently loses access — the admin
   * must reassign holders first.
   */
  async deleteRole(actor: JwtPayload, roleId: string): Promise<void> {
    const role = await this.roleRepo.findById(roleId);
    if (!role || (role.workspaceId !== null && role.workspaceId !== actor.workspaceId)) {
      throw new NotFoundException('ROLE_NOT_FOUND', 'Role not found');
    }
    if (role.isSystem || role.workspaceId === null) {
      throw new ConflictException('ROLE_IMMUTABLE', 'Built-in system roles cannot be deleted');
    }
    const holders = await this.assignmentRepo.listUserIdsForRole(roleId);
    if (holders.length > 0) {
      throw new ConflictException(
        'ROLE_IN_USE',
        `This role is still assigned to ${holders.length} user(s); reassign them before deleting it`,
      );
    }

    await this.uow.run(async (tx) => {
      await this.roleRepo.delete(roleId, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.ROLE_DELETED,
          resourceType: AUDIT_RESOURCE.ROLE,
          resourceId: roleId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          changes: { before: { name: role.name, slug: role.slug } },
        },
        tx,
      );
    });
    this.logger.log({ roleId, deletedBy: actor.sub }, 'Custom role deleted');
  }

  /**
   * A custom role may only carry concrete codes the ACTOR themselves holds
   * (no privilege escalation) and never a wildcard (`ns:*` is reserved for
   * built-ins). Today only workspace_admin (workspace:*) manages roles, so this
   * is a guard-rail for future finer-grained role admins.
   */
  private assertGrantablePermissions(actor: JwtPayload, permissions: string[]): void {
    for (const code of permissions) {
      if (code.endsWith(':*')) {
        throw new ConflictException(
          'ROLE_WILDCARD_FORBIDDEN',
          `Wildcard permission "${code}" cannot be granted to a custom role`,
        );
      }
      if (!permissionGrants(actor.permissions, code)) {
        throw new PermissionDeniedException(
          'ROLE_PERMISSION_ESCALATION',
          `You cannot grant "${code}" because you do not hold it`,
        );
      }
    }
  }

  /** Slug from the name, unique among the roles visible to the workspace. */
  private async deriveUniqueSlug(workspaceId: string, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'role';
    const taken = new Set((await this.roleRepo.listForWorkspace(workspaceId)).map((r) => r.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base}_${i}`;
      if (!taken.has(candidate)) return candidate;
    }
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
    await this.invalidateBaselineTokens(scopeType, userId);
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
    await this.invalidateBaselineTokens(assignment.scopeType, assignment.userId);
    this.logger.log({ assignmentId, revokedBy: actor.sub }, 'Role revoked');
  }

  /**
   * Assign a role to a user scoped to a SINGLE project. This is the endpoint a
   * project admin (holding `project:manage_members` on that project) uses to
   * manage their own project's membership — distinct from workspace-wide
   * assignment which requires `users:assign_role`.
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
    const defaultRole = roles.find((r) => r.slug === defaultRoleSlug);
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
    await this.authzEpoch.bump(userId);
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
    await this.authzEpoch.bump(userId);
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
      // No workspace/global assignment: minimal authenticated baseline so the
      // app shell + workspace read work; all project delivery access is granted
      // per-project by an explicit role (SRS: project access is the primary
      // gate). No canonical role fits, so report an empty representative role.
      return {
        role: '',
        permissions: [PERMISSION.WORKSPACE_VIEW, PERMISSION.PROJECT_VIEW],
      };
    }

    const permissions = [...new Set(baseline.flatMap((a) => a.permissions))];

    // Representative role: prefer a global assignment, else the first workspace one.
    const primary = baseline.find((a) => a.scopeType === 'global') ?? baseline[0];

    return {
      role: primary.roleSlug ?? '',
      permissions,
    };
  }

  /**
   * Effective permissions for a specific PROJECT: the user's workspace-wide
   * baseline (global + workspace) unioned with any role they hold that is
   * scoped to exactly this project. Used by the PolicyGuard at request time so
   * "admin of Project X, viewer of Project Y" is actually enforced.
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
   * Service-layer per-project check, kept for the few authorizations a
   * route-scoped guard cannot express: a project id known only after loading a
   * resource, a multi-project batch, or a secondary target. Throws
   * PermissionDeniedException (403) when the caller lacks `required` for
   * `projectId`. Wildcards are honoured.
   *
   * Guard-based routes (project id resolvable from the request) use
   * @RequirePermission + PolicyGuard instead — don't double-check.
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
