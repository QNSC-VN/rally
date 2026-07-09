/**
 * Canonical permission catalogue — the SINGLE source of truth for RBAC.
 *
 * This file lives in db/ (not libs/) on purpose: it is the ONE place both the
 * standalone migrator/seed image (which only bundles db/**) and the NestJS app
 * (via @shared-kernel, which re-exports this) can import. Keeping it here is
 * what stops the seed's role definitions, the backend @RequirePermission
 * decorators, and the frontend hasPermission() gating from drifting apart.
 *
 * Guard semantics: `workspace:*` grants everything; a `ns:*` wildcard grants
 * that namespace; otherwise an exact code match is required. Deny by default.
 *
 * ⚠️  Dependency-free by design — do NOT import from libs/ here, or the migrator
 *     Docker image (db/** only) will fail to build.
 */

export const SYSTEM_ROLE = {
  WORKSPACE_ADMIN: 'workspace_admin',
  PROJECT_ADMIN: 'project_admin',
  PROJECT_MEMBER: 'project_member',
  PROJECT_VIEWER: 'project_viewer',
  WORKSPACE_MEMBER: 'workspace_member',
  GUEST: 'guest',
} as const;

export const PERMISSION = {
  // ── workspace namespace ────────────────────────────────────────────────────
  WORKSPACE_ALL: 'workspace:*',
  WORKSPACE_VIEW: 'workspace:view',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_MANAGE_MEMBERS: 'workspace:manage_members',
  WORKSPACE_MANAGE_TEAMS: 'workspace:manage_teams',

  // ── project namespace ──────────────────────────────────────────────────────
  PROJECT_VIEW: 'project:view',
  PROJECT_CREATE: 'project:create',
  PROJECT_EDIT: 'project:edit',
  PROJECT_ARCHIVE: 'project:archive',
  PROJECT_RESTORE: 'project:restore',
  PROJECT_DELETE: 'project:delete',
  PROJECT_MANAGE_MEMBERS: 'project:manage_members',

  // ── work_item namespace ────────────────────────────────────────────────────
  WORK_ITEM_VIEW: 'work_item:view',
  WORK_ITEM_VIEW_PUBLIC: 'work_item:view:public',
  WORK_ITEM_CREATE: 'work_item:create',
  WORK_ITEM_EDIT: 'work_item:edit',
  WORK_ITEM_DELETE: 'work_item:delete',

  // ── iteration namespace ────────────────────────────────────────────────────
  ITERATION_VIEW: 'iteration:view',
  ITERATION_MANAGE: 'iteration:manage',

  // ── release namespace ──────────────────────────────────────────────────────
  RELEASE_MANAGE: 'release:manage',

  // ── team-status namespace (P3.1) ────────────────────────────────────────────
  TEAM_STATUS_VIEW: 'team_status:view',
  TEAM_STATUS_EDIT: 'team_status:edit',
} as const;

/** Union of every valid permission code. */
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

/** Union of every valid system-role slug. */
export type SystemRoleSlug = (typeof SYSTEM_ROLE)[keyof typeof SYSTEM_ROLE];

/**
 * The one wildcard-aware permission check, shared by every guard and service so
 * the semantics can't drift. A caller holding `permissions` is granted `required`
 * when any of these is true:
 *   - `workspace:*`  — the global wildcard grants everything
 *   - an exact match of `required`
 *   - `ns:*`         — the namespace wildcard (e.g. `work_item:*` grants
 *                      `work_item:edit`)
 */
export function permissionGrants(
  permissions: readonly string[] | undefined,
  required: string,
): boolean {
  if (!permissions?.length) return false;
  if (permissions.includes(PERMISSION.WORKSPACE_ALL) || permissions.includes(required)) {
    return true;
  }
  const ns = required.split(':')[0];
  return !!ns && permissions.includes(`${ns}:*`);
}

/**
 * Role → permission grants. Authoritative definition consumed by the DB seed.
 * `workspace_admin` also carries `workspace:*`, so it implicitly grants
 * everything; the explicit management codes are still listed so the catalogue
 * reads honestly and no admin endpoint depends on the wildcard alone.
 */
export const ROLE_PERMISSIONS: Record<SystemRoleSlug, Permission[]> = {
  [SYSTEM_ROLE.WORKSPACE_ADMIN]: [
    PERMISSION.WORKSPACE_ALL,
    PERMISSION.WORKSPACE_VIEW,
    PERMISSION.WORKSPACE_CREATE,
    PERMISSION.WORKSPACE_MANAGE_MEMBERS,
    PERMISSION.WORKSPACE_MANAGE_TEAMS,
    PERMISSION.PROJECT_VIEW,
    PERMISSION.PROJECT_CREATE,
    PERMISSION.PROJECT_EDIT,
    PERMISSION.PROJECT_ARCHIVE,
    PERMISSION.PROJECT_RESTORE,
    PERMISSION.PROJECT_DELETE,
    PERMISSION.PROJECT_MANAGE_MEMBERS,
    PERMISSION.WORK_ITEM_CREATE,
    PERMISSION.WORK_ITEM_EDIT,
    PERMISSION.WORK_ITEM_DELETE,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.ITERATION_MANAGE,
    PERMISSION.RELEASE_MANAGE,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.TEAM_STATUS_EDIT,
  ],
  [SYSTEM_ROLE.PROJECT_ADMIN]: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.PROJECT_CREATE,
    PERMISSION.PROJECT_EDIT,
    PERMISSION.PROJECT_ARCHIVE,
    PERMISSION.PROJECT_RESTORE,
    PERMISSION.PROJECT_MANAGE_MEMBERS,
    PERMISSION.WORK_ITEM_CREATE,
    PERMISSION.WORK_ITEM_EDIT,
    PERMISSION.WORK_ITEM_DELETE,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.ITERATION_MANAGE,
    PERMISSION.RELEASE_MANAGE,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.TEAM_STATUS_EDIT,
  ],
  [SYSTEM_ROLE.PROJECT_MEMBER]: [
    // project:view lets a member see the projects (and teams) they belong to —
    // without it the Projects nav and team pickers are empty for every member.
    PERMISSION.PROJECT_VIEW,
    // BA spec: Developer can update any work item (no "own-only" concept)
    PERMISSION.WORK_ITEM_CREATE,
    PERMISSION.WORK_ITEM_EDIT,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.TEAM_STATUS_VIEW,
  ],
  [SYSTEM_ROLE.PROJECT_VIEWER]: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.TEAM_STATUS_VIEW,
  ],
  [SYSTEM_ROLE.WORKSPACE_MEMBER]: [PERMISSION.WORKSPACE_VIEW, PERMISSION.PROJECT_VIEW],
  [SYSTEM_ROLE.GUEST]: [PERMISSION.WORK_ITEM_VIEW_PUBLIC],
};

/** Human-readable role names for the seed / admin UI. */
export const ROLE_NAMES: Record<SystemRoleSlug, string> = {
  [SYSTEM_ROLE.WORKSPACE_ADMIN]: 'Workspace Admin',
  [SYSTEM_ROLE.PROJECT_ADMIN]: 'Project Admin',
  [SYSTEM_ROLE.PROJECT_MEMBER]: 'Project Member',
  [SYSTEM_ROLE.PROJECT_VIEWER]: 'Project Viewer',
  [SYSTEM_ROLE.WORKSPACE_MEMBER]: 'Workspace Member',
  [SYSTEM_ROLE.GUEST]: 'Guest',
};
