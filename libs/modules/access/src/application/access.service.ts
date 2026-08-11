import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { CacheService } from '@qnsc-vn/platform-cache';
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
  PERMISSION_TIER,
  permissionGrants,
  isProjectTierPermission,
  ACCESS_LEVEL_PERMISSIONS,
  type ProjectPermission,
  type ProjectAccessLevel,
} from '@shared-kernel';
import type { JwtPayload, DrizzleDB } from '@platform';
import { InjectDrizzle } from '@platform';
import { and, eq } from 'drizzle-orm';
import { projectMembers, projects, teamMembers, projectTeams } from '../../../../../db/schema/work';
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
    private readonly cache: CacheService,
    // Read-only, for `listReadableProjectIds`: project membership is the roster
    // equivalent of Rally's ProjectPermission and has no repository port of its own.
    @InjectDrizzle() private readonly db: DrizzleDB,
  ) {}

  // ── Effective-assignment resolution (the one read every check goes through) ──

  private static readonly ASSIGNMENTS_TTL_SECONDS = 300;

  private assignmentsKey(workspaceId: string, userId: string): string {
    return `authz:assign:${workspaceId}:${userId}`;
  }

  /**
   * Every authorization decision in rally reduces to this one read: the user's
   * role assignments in a workspace, each with its permission codes. Baseline
   * (global + workspace) and per-project sets are then filtered out of it in
   * memory, so one cached read serves both tiers.
   *
   * Cached in Valkey for 5 minutes under a per-(workspace, user) key, which the
   * write paths delete explicitly — so a role change lands on the user's NEXT
   * request, on every replica, rather than when their token happens to rotate.
   * The TTL is only the backstop for a missed invalidation.
   *
   * Fails OPEN to the database, not to deny: a cache outage must degrade
   * latency, not authorization. A read error means every check does the join it
   * used to do before this cache existed.
   */
  private async effectiveAssignments(
    workspaceId: string,
    userId: string,
  ): Promise<
    Array<{
      scopeType: ScopeType;
      scopeId: string | null;
      roleSlug: string | null;
      permissions: string[];
    }>
  > {
    const key = this.assignmentsKey(workspaceId, userId);
    try {
      const cached = await this.cache.getJson<
        Array<{
          scopeType: ScopeType;
          scopeId: string | null;
          roleSlug: string | null;
          permissions: string[];
        }>
      >(key);
      if (cached) return cached;
    } catch (err) {
      this.logger.warn(
        { err, userId },
        'Effective-assignment cache read failed; using the database',
      );
    }

    const rows = await this.assignmentRepo.listEffectiveForUser(workspaceId, userId);

    // RBAC migration Phase 3 — synthesize project-scoped assignments from the
    // per-Project access_level (the new model on work.project_members). The
    // legacy scopeType='project' rows from listEffectiveForUser still appear too
    // (safety net until Phase 10 deletes them); they overlap during the
    // transition, which is consistent and never over-grants because the Phase 1
    // backfill mapped slugs to the same permission sets.
    const accessRows = await this.db
      .select({
        projectId: projectMembers.projectId,
        accessLevel: projectMembers.accessLevel,
      })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.workspaceId, workspaceId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.status, 'active'),
        ),
      );
    const synthesized: Array<{
      scopeType: ScopeType;
      scopeId: string;
      roleSlug: string | null;
      permissions: string[];
    }> = accessRows
      .filter(
        (r) =>
          r.accessLevel === 'admin' || r.accessLevel === 'editor' || r.accessLevel === 'viewer',
      )
      .map((r) => ({
        scopeType: 'project',
        scopeId: r.projectId,
        roleSlug: r.accessLevel,
        permissions: [...ACCESS_LEVEL_PERMISSIONS[r.accessLevel as ProjectAccessLevel]],
      }));
    const all = [...rows, ...synthesized];

    try {
      await this.cache.setJson(key, all, AccessService.ASSIGNMENTS_TTL_SECONDS);
    } catch (err) {
      this.logger.warn({ err, userId }, 'Effective-assignment cache write failed; continuing');
    }
    return all;
  }

  /**
   * Drop a user's cached assignments so their next request re-resolves.
   *
   * Call AFTER the write commits: invalidating first lets a concurrent request
   * repopulate the cache from pre-commit state, which is the staleness this
   * exists to remove. Never throws — the write already succeeded, and the TTL
   * bounds the damage of a failed delete.
   */
  async invalidateUser(workspaceId: string, userId: string): Promise<void> {
    try {
      await this.cache.del(this.assignmentsKey(workspaceId, userId));
    } catch (err) {
      this.logger.error(
        { err, userId, workspaceId },
        'Failed to invalidate cached permissions; the change takes effect within the cache TTL',
      );
    }
  }

  /** Fan-out invalidation — e.g. editing a role's permission set affects every holder. */
  async invalidateUsers(workspaceId: string, userIds: readonly string[]): Promise<void> {
    await Promise.all([...new Set(userIds)].map((id) => this.invalidateUser(workspaceId, id)));
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
    await this.assertGrantablePermissions(actor, permissions);

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
    // A role's permission set changed, so every holder's cached resolution is
    // stale. Assignees are read after the commit so the list reflects the new state.
    const assignees = await this.assignmentRepo.listUserIdsForRole(roleId);
    await this.invalidateUsers(actor.workspaceId, assignees);

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
    await this.assertGrantablePermissions(actor, input.permissions);
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
    // A canonical tier role (workspace_admin/project_admin/project_member) is
    // never deletable, even as a per-workspace editable copy — only its
    // permissions may be tuned. Custom roles delete freely.
    const canonical = (Object.values(SYSTEM_ROLE) as string[]).includes(role.slug);
    if (role.isSystem || role.workspaceId === null || canonical) {
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
  private async assertGrantablePermissions(
    actor: JwtPayload,
    permissions: string[],
  ): Promise<void> {
    // The actor's own baseline is resolved, not read off the token: no-escalation
    // must be judged against what the actor holds RIGHT NOW, or an admin whose
    // grant was just revoked could still hand it out until their token rotated.
    const held = await this.getWorkspacePermissions(actor.sub, actor.workspaceId);
    for (const code of permissions) {
      if (code.endsWith(':*')) {
        throw new ConflictException(
          'ROLE_WILDCARD_FORBIDDEN',
          `Wildcard permission "${code}" cannot be granted to a custom role`,
        );
      }
      if (!permissionGrants(held, code)) {
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
    // Every scope type invalidates: unlike the old token epoch — which skipped
    // project-scoped changes because they were never in the token — the cache now
    // holds the assignment rows the project-tier check reads too.
    await this.invalidateUser(actor.workspaceId, userId);
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
    await this.invalidateUser(assignment.workspaceId, assignment.userId);
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
    // Invalidate the permission cache so the revocation takes effect on the
    // user's next request (mirrors revokeRole). Without this a revoked project
    // role stays effective up to the cache TTL on every replica.
    await this.invalidateUser(assignment.workspaceId, assignment.userId);
    this.logger.log({ assignmentId, projectId, revokedBy: actor.sub }, 'Project role revoked');
  }

  /** Check if a user has a specific permission in any scope. Used by guards.
   * Wildcard expansion: `workspace:*` matches any `workspace:<action>`.
   * NOTE: assumes 2-segment permission strings (namespace:action). If 3-segment
   * permissions are added in future, expand this to check prefix wildcards at
   * each segment boundary (e.g. `workspace:admin:*` matches `workspace:admin:write`).
   */
  async hasPermission(workspaceId: string, userId: string, permission: string): Promise<boolean> {
    const effective = await this.effectiveAssignments(workspaceId, userId);
    if (!effective.length) return false;

    const [reqNs] = permission.split(':');
    return effective.some(
      (a) => a.permissions.includes(`${reqNs}:*`) || a.permissions.includes(permission),
    );
  }

  /**
   * The user's per-Project access level (RBAC migration Phase 9). Resolved from
   * the synthesized project-scoped entry in effectiveAssignments (roleSlug =
   * 'admin' | 'editor' | 'viewer'). null when the user has no project entry
   * (Workspace Admin via workspace:*, or No Access).
   */
  async getProjectAccessLevel(
    workspaceId: string,
    userId: string,
    projectId: string,
  ): Promise<ProjectAccessLevel | null> {
    const eff = await this.effectiveAssignments(workspaceId, userId);
    const entry = eff.find(
      (a) =>
        a.scopeType === 'project' &&
        a.scopeId === projectId &&
        (a.roleSlug === 'admin' || a.roleSlug === 'editor' || a.roleSlug === 'viewer'),
    );
    return (entry?.roleSlug as ProjectAccessLevel | undefined) ?? null;
  }

  /**
   * Phase 9 team-scoped enforcement. An Editor may only mutate work in their
   * assigned Teams; Admin (All Teams), Viewer (no writes), and Workspace Admin
   * (workspace:*) bypass. Call AFTER the project-level write permission check.
   * A team-agnostic item (teamId null) is not team-scoped.
   */
  async assertTeamScoped(
    actor: JwtPayload,
    projectId: string,
    teamId: string | null,
  ): Promise<void> {
    if (!teamId) return;
    const level = await this.getProjectAccessLevel(actor.workspaceId, actor.sub, projectId);
    if (level !== 'editor') return; // admin/WA bypass; viewer holds no write codes
    const teams = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .innerJoin(projectTeams, eq(projectTeams.teamId, teamMembers.teamId))
      .where(
        and(
          eq(teamMembers.workspaceId, actor.workspaceId),
          eq(teamMembers.userId, actor.sub),
          eq(projectTeams.projectId, projectId),
          eq(teamMembers.status, 'active'),
          eq(projectTeams.status, 'active'),
        ),
      );
    if (!teams.some((t) => t.teamId === teamId)) {
      throw new PermissionDeniedException(
        'TEAM_NOT_IN_SCOPE',
        'Editors can only modify work in their assigned teams',
      );
    }
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
  ensureDefaultRole(
    _userId: string,
    _workspaceId: string,
    _defaultRoleSlug: string = SYSTEM_ROLE.PROJECT_MEMBER,
  ): Promise<void> {
    // RBAC migration Phase 4: a JIT-provisioned (first SSO sign-in) user lands
    // with ZERO project access — no automatic workspace-scoped role, because
    // that would grant project delivery access company-wide. The user is still
    // an authenticated company member (workspace_members row from SSO) and can
    // sign in + see the shell via the empty-baseline fallback; Workspace Admin
    // grants per-Project access (admin/editor/viewer) afterwards. No-op until a
    // non-project default role exists.
    return Promise.resolve();
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
    await this.invalidateUser(workspaceId, userId);
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
  /**
   * The user's workspace-tier permissions, resolved (and cached) from the
   * database. This is what `PolicyGuard` checks a workspace-tier code against,
   * and what an escalation check judges an actor by.
   *
   * Deliberately a thin projection of {@link getUserRoleAndPermissions} rather
   * than a second resolution path — two ways to compute a baseline is exactly how
   * a guard and a UI end up disagreeing about what a user can do.
   */
  async getWorkspacePermissions(userId: string, workspaceId: string): Promise<string[]> {
    const { permissions } = await this.getUserRoleAndPermissions(userId, workspaceId);
    return permissions;
  }

  async getUserRoleAndPermissions(
    userId: string,
    workspaceId: string,
  ): Promise<{ role: string; permissions: string[] }> {
    const effective = await this.effectiveAssignments(workspaceId, userId);
    const baseline = effective.filter(
      (a) => a.scopeType === 'global' || a.scopeType === 'workspace',
    );

    if (!baseline.length) {
      // No workspace/global assignment: minimal authenticated baseline so the
      // app shell + workspace read work. Project delivery access is granted
      // ONLY by an explicit per-Project access_level (RBAC migration Phase 4:
      // No Access is the default for JIT/no-assignment users until Workspace
      // Admin grants access). No canonical role fits, so report an empty role.
      return {
        role: '',
        permissions: [PERMISSION.WORKSPACE_VIEW],
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
    const effective = await this.effectiveAssignments(workspaceId, userId);
    const relevant = effective.filter(
      (a) =>
        a.scopeType === 'global' ||
        a.scopeType === 'workspace' ||
        (a.scopeType === 'project' && a.scopeId === projectId),
    );

    return [...new Set(relevant.flatMap((a) => a.permissions))];
  }

  /**
   * Project ids the user may READ in this workspace.
   *
   * The authorization fact behind every CROSS-PROJECT list. It belongs here, not in a
   * feature repository, because more than one surface needs it (portfolio items now,
   * capacity plans next) and because getting it wrong leaks another project's data.
   *
   * Mirrors Rally, where access to an artifact follows from permission on its PROJECT
   * rather than from any per-artifact grant: Rally stores one `ProjectPermission` row
   * per (user, project, workspace) and a Viewer sees everything in that project.
   *
   * Three sources, unioned:
   *   1. a workspace-wide grant (`workspace:*` or an explicit workspace-tier `:view`)
   *      sees every project — Rally's Workspace Admin;
   *   2. project-scoped role assignments (`scope_type='project'`) — Rally's per-project
   *      Editor/Viewer/Project Admin;
   *   3. active project membership — the roster equivalent, so a member who holds no
   *      explicit role assignment still sees their own project.
   *
   * Returns `null` to mean UNRESTRICTED, deliberately: an empty array is a legitimate
   * answer ("no projects"), so a sentinel is needed to distinguish it from "all". A
   * caller that treats `null` as empty fails closed, which is the safe direction.
   */
  async listReadableProjectIds(
    workspaceId: string,
    userId: string,
    permission: ProjectPermission,
  ): Promise<string[] | null> {
    const effective = await this.effectiveAssignments(workspaceId, userId);

    // Workspace-wide grant → every project. Wildcards honoured the same way the guard
    // honours them, so `workspace:*` behaves consistently in both places.
    const workspaceWide = effective.some(
      (a) =>
        (a.scopeType === 'global' || a.scopeType === 'workspace') &&
        permissionGrants(a.permissions, permission),
    );
    if (workspaceWide) return null;

    const fromAssignments = effective
      .filter(
        (a) =>
          a.scopeType === 'project' &&
          a.scopeId !== null &&
          permissionGrants(a.permissions, permission),
      )
      .map((a) => a.scopeId as string);

    const memberships = await this.db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projectMembers.workspaceId, workspaceId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.status, 'active'),
        ),
      );

    return [...new Set([...fromAssignments, ...memberships.map((m) => m.projectId)])];
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
    if (await this.hasProjectPermission(user, projectId, required)) return;

    throw new PermissionDeniedException(
      'PROJECT_PERMISSION_DENIED',
      'You do not have permission to perform this action on this project',
    );
  }

  /**
   * The same check as `assertProjectPermission`, as a QUESTION rather than a demand.
   *
   * Some rules branch on a permission instead of refusing without it: a capacity plan in Draft is
   * hidden from a reader who cannot plan, which means the list has to ASK whether this caller is a
   * planner and filter — throwing there would deny the whole list over one row.
   *
   * Deliberately not a second implementation: catching the exception from the assert would work and
   * would also make an ordinary branch look like an error path in every log and trace.
   */
  async hasProjectPermission(
    user: JwtPayload,
    projectId: string,
    required: ProjectPermission,
  ): Promise<boolean> {
    // No token fast path: `getProjectPermissions` already unions the workspace
    // baseline, and it reads through the cache, so the old shortcut only added a
    // way to answer from a stale snapshot.
    const effective = await this.getProjectPermissions(user.sub, user.workspaceId, projectId);
    return permissionGrants(effective, required);
  }

  /** Wildcard-aware membership check: workspace:* / ns:* / exact match. */
}
