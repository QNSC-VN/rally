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
  WORK_ITEM_CREATE: 'work_item:create',
  WORK_ITEM_EDIT: 'work_item:edit',
  WORK_ITEM_DELETE: 'work_item:delete',

  // ── iteration namespace ────────────────────────────────────────────────────
  ITERATION_VIEW: 'iteration:view',
  ITERATION_CREATE: 'iteration:create',
  ITERATION_EDIT: 'iteration:edit',
  ITERATION_DELETE: 'iteration:delete',

  // ── release namespace ──────────────────────────────────────────────────────
  RELEASE_VIEW: 'release:view',
  RELEASE_CREATE: 'release:create',
  RELEASE_EDIT: 'release:edit',
  RELEASE_DELETE: 'release:delete',

  // ── team-status namespace (P3.1) ───────────────────────────────────────────
  TEAM_STATUS_VIEW: 'team_status:view',
  TEAM_STATUS_EDIT: 'team_status:edit',

  // ── quality namespace (P3.4) ───────────────────────────────────────────────
  QUALITY_VIEW: 'quality:view',
  QUALITY_EDIT: 'quality:edit',

  // ── milestone namespace (P3.3) ─────────────────────────────────────────────
  MILESTONE_VIEW: 'milestone:view',
  MILESTONE_CREATE: 'milestone:create',
  MILESTONE_EDIT: 'milestone:edit',
  MILESTONE_DELETE: 'milestone:delete',
} as const;

/** Union of every valid permission code. */
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

/** Union of every valid system-role slug. */
export type SystemRoleSlug = (typeof SYSTEM_ROLE)[keyof typeof SYSTEM_ROLE];

/**
 * The SCOPE TIER of every permission — the single fact that decides how it is
 * enforced, so a permission can never be checked at the wrong scope by accident:
 *
 *   - `workspace` — resolved against the workspace-wide baseline baked into the
 *     JWT (the flat `@RequirePermission` guard). It isn't tied to a single
 *     project instance: administering the workspace, or minting a new project.
 *   - `project`  — resolved PER PROJECT at request time as
 *     `baseline ∪ project-scoped role` (the `@RequireProjectPermission` guard,
 *     or `AccessService.assertProjectPermission` when the project id is only
 *     known after loading a resource). Everything that acts on an EXISTING
 *     project is project-tier — including `project:delete` (it targets a
 *     specific project; only workspace_admin holds it, so `workspace:*`
 *     fast-paths the check regardless of tier).
 *
 * The derived `WorkspacePermission` / `ProjectPermission` types below feed the
 * two decorators' signatures, which is what makes a mis-scoped guard a COMPILE
 * error rather than a silent authorization gap.
 */
export const PERMISSION_TIER = {
  [PERMISSION.WORKSPACE_ALL]: 'workspace',
  [PERMISSION.WORKSPACE_VIEW]: 'workspace',
  [PERMISSION.WORKSPACE_CREATE]: 'workspace',
  [PERMISSION.WORKSPACE_MANAGE_MEMBERS]: 'workspace',
  [PERMISSION.WORKSPACE_MANAGE_TEAMS]: 'workspace',
  [PERMISSION.PROJECT_CREATE]: 'workspace',

  [PERMISSION.PROJECT_VIEW]: 'project',
  [PERMISSION.PROJECT_EDIT]: 'project',
  [PERMISSION.PROJECT_ARCHIVE]: 'project',
  [PERMISSION.PROJECT_RESTORE]: 'project',
  [PERMISSION.PROJECT_DELETE]: 'project',
  [PERMISSION.PROJECT_MANAGE_MEMBERS]: 'project',
  [PERMISSION.WORK_ITEM_VIEW]: 'project',
  [PERMISSION.WORK_ITEM_CREATE]: 'project',
  [PERMISSION.WORK_ITEM_EDIT]: 'project',
  [PERMISSION.WORK_ITEM_DELETE]: 'project',
  [PERMISSION.ITERATION_VIEW]: 'project',
  [PERMISSION.ITERATION_CREATE]: 'project',
  [PERMISSION.ITERATION_EDIT]: 'project',
  [PERMISSION.ITERATION_DELETE]: 'project',
  [PERMISSION.RELEASE_VIEW]: 'project',
  [PERMISSION.RELEASE_CREATE]: 'project',
  [PERMISSION.RELEASE_EDIT]: 'project',
  [PERMISSION.RELEASE_DELETE]: 'project',
  [PERMISSION.TEAM_STATUS_VIEW]: 'project',
  [PERMISSION.TEAM_STATUS_EDIT]: 'project',
  [PERMISSION.QUALITY_VIEW]: 'project',
  [PERMISSION.QUALITY_EDIT]: 'project',
  [PERMISSION.MILESTONE_VIEW]: 'project',
  [PERMISSION.MILESTONE_CREATE]: 'project',
  [PERMISSION.MILESTONE_EDIT]: 'project',
  [PERMISSION.MILESTONE_DELETE]: 'project',
} as const satisfies Record<Permission, 'workspace' | 'project'>;

/** Permissions enforced against the workspace-wide JWT baseline. */
export type WorkspacePermission = {
  [K in Permission]: (typeof PERMISSION_TIER)[K] extends 'workspace' ? K : never;
}[Permission];

/** Permissions resolved per-project (baseline ∪ project-scoped role). */
export type ProjectPermission = {
  [K in Permission]: (typeof PERMISSION_TIER)[K] extends 'project' ? K : never;
}[Permission];

/** Runtime tier lookup — mirror of the compile-time split for guard internals. */
export function isProjectTierPermission(permission: string): permission is ProjectPermission {
  return (PERMISSION_TIER as Record<string, 'workspace' | 'project'>)[permission] === 'project';
}

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
 *
 * Two invariants keep this table sane and enterprise-safe — preserve them when
 * editing:
 *   1. MONOTONIC TIERS — project_viewer ⊆ project_member ⊆ project_admin, and
 *      workspace_admin (via `workspace:*`) ⊇ everything. A higher role is always
 *      a strict superset of the one below it.
 *   2. MANAGE IMPLIES VIEW — any role holding an `X:manage` / `X:edit` grant also
 *      holds the matching `X:view`. You can't manage what you can't see.
 *
 * `workspace_admin` also carries `workspace:*`, so it implicitly grants
 * everything; the explicit codes are still listed so the catalogue reads
 * honestly and no admin endpoint depends on the wildcard alone.
 *
 * Scope note: `project:create` / `project:delete` are WORKSPACE-tier actions
 * (mint / destroy a project) — only workspace_admin holds them. A project-scoped
 * role governs projects that already exist, it does not create new ones.
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
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.WORK_ITEM_CREATE,
    PERMISSION.WORK_ITEM_EDIT,
    PERMISSION.WORK_ITEM_DELETE,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.ITERATION_CREATE,
    PERMISSION.ITERATION_EDIT,
    PERMISSION.ITERATION_DELETE,
    PERMISSION.RELEASE_VIEW,
    PERMISSION.RELEASE_CREATE,
    PERMISSION.RELEASE_EDIT,
    PERMISSION.RELEASE_DELETE,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.TEAM_STATUS_EDIT,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_EDIT,
    PERMISSION.MILESTONE_VIEW,
    PERMISSION.MILESTONE_CREATE,
    PERMISSION.MILESTONE_EDIT,
    PERMISSION.MILESTONE_DELETE,
  ],
  // Full control of an EXISTING project. No project:create / project:delete
  // (workspace-tier) and no workspace admin powers.
  [SYSTEM_ROLE.PROJECT_ADMIN]: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.PROJECT_EDIT,
    PERMISSION.PROJECT_ARCHIVE,
    PERMISSION.PROJECT_RESTORE,
    PERMISSION.PROJECT_MANAGE_MEMBERS,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.WORK_ITEM_CREATE,
    PERMISSION.WORK_ITEM_EDIT,
    PERMISSION.WORK_ITEM_DELETE,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.ITERATION_CREATE,
    PERMISSION.ITERATION_EDIT,
    PERMISSION.ITERATION_DELETE,
    PERMISSION.RELEASE_VIEW,
    PERMISSION.RELEASE_CREATE,
    PERMISSION.RELEASE_EDIT,
    PERMISSION.RELEASE_DELETE,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.TEAM_STATUS_EDIT,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_EDIT,
    PERMISSION.MILESTONE_VIEW,
    PERMISSION.MILESTONE_CREATE,
    PERMISSION.MILESTONE_EDIT,
    PERMISSION.MILESTONE_DELETE,
  ],
  // Contributor: creates/edits work items & defects; reads everything else.
  // No delete, no manage (iterations/releases/milestones/team capacity).
  [SYSTEM_ROLE.PROJECT_MEMBER]: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.WORK_ITEM_CREATE,
    PERMISSION.WORK_ITEM_EDIT,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.RELEASE_VIEW,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_EDIT,
    PERMISSION.MILESTONE_VIEW,
  ],
  // Read-only across one project.
  [SYSTEM_ROLE.PROJECT_VIEWER]: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.RELEASE_VIEW,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.MILESTONE_VIEW,
  ],
  // Workspace-wide read-only observer (sees the workspace + all project reads).
  [SYSTEM_ROLE.WORKSPACE_MEMBER]: [
    PERMISSION.WORKSPACE_VIEW,
    PERMISSION.PROJECT_VIEW,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.RELEASE_VIEW,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.MILESTONE_VIEW,
  ],
};

/** Human-readable role names for the seed / admin UI. */
export const ROLE_NAMES: Record<SystemRoleSlug, string> = {
  [SYSTEM_ROLE.WORKSPACE_ADMIN]: 'Workspace Admin',
  [SYSTEM_ROLE.PROJECT_ADMIN]: 'Project Admin',
  [SYSTEM_ROLE.PROJECT_MEMBER]: 'Project Member',
  [SYSTEM_ROLE.PROJECT_VIEWER]: 'Project Viewer',
  [SYSTEM_ROLE.WORKSPACE_MEMBER]: 'Workspace Member',
};

/**
 * PRESET FUNCTIONAL roles — seeded PER WORKSPACE as ordinary, EDITABLE custom
 * roles (`isSystem: false`, `workspaceId` set), NOT part of the enforcement
 * backbone above.
 *
 * Why they exist: the five SYSTEM roles are capability TIERS (viewer ⊆ member ⊆
 * admin) — the drift-proof authorization ladder. Real teams, however, think in
 * JOB FUNCTIONS. The BA role model (mini_rally_usecase_role_mapping) enumerates
 * Scrum Master / Product Owner / Developer / QA, so every workspace is seeded
 * with matching ready-to-assign roles. Because they are plain custom roles they:
 *   - appear in Settings → Roles & Permissions as EDITABLE rows (admins tune them),
 *   - carry ONLY concrete project-tier permissions (no wildcards) — deny-by-default,
 *   - never affect the tier ladder or any guard's fast-path.
 *
 * Each permission set is derived directly from the BA use-case matrix and obeys
 * the catalogue's "manage/edit implies view" invariant. Workspace Admin, PM and
 * Viewer are intentionally omitted — they map 1:1 onto the existing system tiers
 * (`workspace_admin`, `project_admin`, `project_viewer`).
 *
 * Slugs are globally unique (matching the `uq_system_roles_slug` constraint) and
 * seeded with onConflictDoNothing, so they are created once and never clobber a
 * workspace admin's later edits.
 */
export type PresetWorkspaceRole = {
  slug: string;
  name: string;
  description: string;
  permissions: Permission[];
};

export const PRESET_WORKSPACE_ROLES: readonly PresetWorkspaceRole[] = [
  {
    slug: 'scrum_master',
    name: 'Scrum Master',
    description:
      'Runs the delivery process: manages iterations, releases, the board and team capacity; full work-item control. Mirrors the BA "PM / Scrum Master" role.',
    permissions: [
      PERMISSION.PROJECT_VIEW,
      PERMISSION.PROJECT_MANAGE_MEMBERS,
      PERMISSION.WORK_ITEM_VIEW,
      PERMISSION.WORK_ITEM_CREATE,
      PERMISSION.WORK_ITEM_EDIT,
      PERMISSION.WORK_ITEM_DELETE,
      PERMISSION.ITERATION_VIEW,
      PERMISSION.ITERATION_CREATE,
      PERMISSION.ITERATION_EDIT,
      PERMISSION.ITERATION_DELETE,
      PERMISSION.RELEASE_VIEW,
      PERMISSION.RELEASE_CREATE,
      PERMISSION.RELEASE_EDIT,
      PERMISSION.RELEASE_DELETE,
      PERMISSION.TEAM_STATUS_VIEW,
      PERMISSION.TEAM_STATUS_EDIT,
      PERMISSION.QUALITY_VIEW,
      PERMISSION.QUALITY_EDIT,
      PERMISSION.MILESTONE_VIEW,
      PERMISSION.MILESTONE_CREATE,
      PERMISSION.MILESTONE_EDIT,
      PERMISSION.MILESTONE_DELETE,
    ],
  },
  {
    slug: 'product_owner',
    name: 'Product Owner',
    description:
      'Owns the backlog and requirements: creates, grooms, prioritizes and assigns work items. Reads iterations, releases and milestones. Mirrors the BA "Product Owner / BA" role.',
    permissions: [
      PERMISSION.PROJECT_VIEW,
      PERMISSION.WORK_ITEM_VIEW,
      PERMISSION.WORK_ITEM_CREATE,
      PERMISSION.WORK_ITEM_EDIT,
      PERMISSION.ITERATION_VIEW,
      PERMISSION.RELEASE_VIEW,
      PERMISSION.TEAM_STATUS_VIEW,
      PERMISSION.QUALITY_VIEW,
      PERMISSION.MILESTONE_VIEW,
    ],
  },
  {
    slug: 'developer',
    name: 'Developer',
    description:
      'Delivers work: updates assigned work items and reports team progress. No create/delete or planning powers. Mirrors the BA "Developer" role.',
    permissions: [
      PERMISSION.PROJECT_VIEW,
      PERMISSION.WORK_ITEM_VIEW,
      PERMISSION.WORK_ITEM_EDIT,
      PERMISSION.ITERATION_VIEW,
      PERMISSION.RELEASE_VIEW,
      PERMISSION.TEAM_STATUS_VIEW,
      PERMISSION.TEAM_STATUS_EDIT,
      PERMISSION.QUALITY_VIEW,
      PERMISSION.MILESTONE_VIEW,
    ],
  },
  {
    slug: 'qa_engineer',
    name: 'QA Engineer',
    description:
      'Owns quality: raises and verifies defects, updates work-item status. Mirrors the BA "Tester / QA" role.',
    permissions: [
      PERMISSION.PROJECT_VIEW,
      PERMISSION.WORK_ITEM_VIEW,
      PERMISSION.WORK_ITEM_CREATE,
      PERMISSION.WORK_ITEM_EDIT,
      PERMISSION.ITERATION_VIEW,
      PERMISSION.RELEASE_VIEW,
      PERMISSION.TEAM_STATUS_VIEW,
      PERMISSION.QUALITY_VIEW,
      PERMISSION.QUALITY_EDIT,
      PERMISSION.MILESTONE_VIEW,
    ],
  },
];
