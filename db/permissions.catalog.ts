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
} as const;

export const PERMISSION = {
  // ── workspace namespace ────────────────────────────────────────────────────
  WORKSPACE_ALL: 'workspace:*',
  WORKSPACE_VIEW: 'workspace:view',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_EDIT: 'workspace:edit',
  WORKSPACE_DELETE: 'workspace:delete',

  // ── users namespace (company member + invitation management) ────────────────
  // Split out of the former coarse `workspace:manage_members` for least-privilege
  // + audit clarity; each is an independent action. (Roster READS stay open to
  // any authenticated member — owner pickers need them — so there is no
  // `users:view` gate.)
  USERS_INVITE: 'users:invite',
  USERS_REMOVE: 'users:remove',
  USERS_ASSIGN_ROLE: 'users:assign_role',

  // ── roles namespace (the Roles & Permissions surface itself) ────────────────
  // Managing WHAT a role can do is a distinct concern from managing PEOPLE —
  // previously conflated under `workspace:manage_members`.
  ROLES_VIEW: 'roles:view',
  ROLES_EDIT: 'roles:edit',

  // ── teams namespace (split out of the former `workspace:manage_teams`) ───────
  // Team READS stay open (project pickers); only writes are gated.
  TEAMS_CREATE: 'teams:create',
  TEAMS_EDIT: 'teams:edit',
  TEAMS_MANAGE_MEMBERS: 'teams:manage_members',

  // ── audit + scm (workspace-tier) ─────────────────────────────────────────────
  AUDIT_VIEW: 'audit:view',
  // Managing SCM installations/repositories is an integrations concern — NOT
  // people management (was wrongly gated by workspace:manage_members).
  SCM_MANAGE: 'scm:manage',

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
  // Quality is a read-only reporting surface (defect dashboard + metrics).
  // Defects ARE work items, so their create/edit/delete flows through the
  // work_item namespace — there is no separate quality write permission.
  QUALITY_VIEW: 'quality:view',

  // ── milestone namespace (P3.3) ─────────────────────────────────────────────
  MILESTONE_VIEW: 'milestone:view',
  MILESTONE_CREATE: 'milestone:create',
  MILESTONE_EDIT: 'milestone:edit',
  MILESTONE_DELETE: 'milestone:delete',

  // ── portfolio namespace (P5.1 — Epic + Feature) ────────────────────────────
  // The BA spec calls the gate `manageFeatures`; translated to the house
  // <entity>:<action> convention. One namespace covers both types: Epic and
  // Feature share a table, a list and a create flow, so a separate epic:* set
  // would be four codes nobody could explain the difference of.
  PORTFOLIO_VIEW: 'portfolio:view',
  PORTFOLIO_CREATE: 'portfolio:create',
  PORTFOLIO_EDIT: 'portfolio:edit',
  // Archive, not delete — the spec has no hard delete for portfolio items.
  PORTFOLIO_ARCHIVE: 'portfolio:archive',

  // ── capacity namespace (P5.2) ──────────────────────────────────────────────
  CAPACITY_VIEW: 'capacity:view',
  CAPACITY_MANAGE: 'capacity:manage',
  // Separate from MANAGE on purpose: publishing WRITES BACK to Feature release and
  // planned dates, so it changes records outside the plan. Editing a draft does not.
  // Different blast radius, different grant.
  CAPACITY_PUBLISH: 'capacity:publish',
  /**
   * See DRAFT plans without being able to change them.
   *
   * The BA has ONE permission (`capacity_planning:manage`) with two settings where we have three
   * codes, and that mismatch made two of its acceptance criteria unsatisfiable at once:
   *
   *   • AC-012 — a Project Admin set to `Read-only` keeps "opening Draft and Published plans while
   *     changing nothing";
   *   • AC-013 — a Project Member does not see Drafts at all.
   *
   * Draft visibility was `capacity:manage || capacity:publish`, so both roles were refused Drafts:
   * AC-013 held and AC-012 did not, and no combination of the three existing codes could tell a
   * read-only Project Admin from a Project Member. This is the fourth code that can. It grants
   * READ only — every write still requires `capacity:manage` or `capacity:publish`.
   */
  CAPACITY_VIEW_DRAFT: 'capacity:view_draft',

  // ── report namespace (P6) ──────────────────────────────────────────────────
  // Iteration Burndown, Velocity and Team Capacity, plus Release Tracking's
  // classification and burnup. ONE read code for the whole surface rather than one
  // per report: the three reports are a single page with a Type selector, and the
  // SRS gives them one authorization boundary ("Enforce Project/Team authorization
  // before returning aggregates"). Splitting it would create three grants nobody
  // could explain the difference between.
  //
  // Not folded into `iteration:view` — which is what the legacy reporting controller
  // reused. A report aggregates ACROSS iterations, releases, tasks and member
  // capacity, so an admin restricting who may read team-level performance data has to
  // be able to do that without also revoking the iteration list.
  //
  // Read-only by design. Nothing in Phase 6 writes through a report: the daily
  // snapshot jobs are internal scheduled work with no HTTP surface, and capacity is
  // still edited through `team_status:edit` on Team Status.
  REPORT_VIEW: 'report:view',
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
  [PERMISSION.WORKSPACE_EDIT]: 'workspace',
  [PERMISSION.WORKSPACE_DELETE]: 'workspace',
  [PERMISSION.USERS_INVITE]: 'workspace',
  [PERMISSION.USERS_REMOVE]: 'workspace',
  [PERMISSION.USERS_ASSIGN_ROLE]: 'workspace',
  [PERMISSION.ROLES_VIEW]: 'workspace',
  [PERMISSION.ROLES_EDIT]: 'workspace',
  [PERMISSION.TEAMS_CREATE]: 'workspace',
  [PERMISSION.TEAMS_EDIT]: 'workspace',
  [PERMISSION.TEAMS_MANAGE_MEMBERS]: 'workspace',
  [PERMISSION.AUDIT_VIEW]: 'workspace',
  [PERMISSION.SCM_MANAGE]: 'workspace',
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
  [PERMISSION.MILESTONE_VIEW]: 'project',
  [PERMISSION.MILESTONE_CREATE]: 'project',
  [PERMISSION.MILESTONE_EDIT]: 'project',
  [PERMISSION.MILESTONE_DELETE]: 'project',
  // Project tier: a portfolio item and a capacity plan both belong to a Project, and
  // the spec scopes visibility by the Projects a user administers or is a member of.
  [PERMISSION.PORTFOLIO_VIEW]: 'project',
  [PERMISSION.PORTFOLIO_CREATE]: 'project',
  [PERMISSION.PORTFOLIO_EDIT]: 'project',
  [PERMISSION.PORTFOLIO_ARCHIVE]: 'project',
  [PERMISSION.CAPACITY_VIEW]: 'project',
  [PERMISSION.CAPACITY_VIEW_DRAFT]: 'project',
  [PERMISSION.CAPACITY_MANAGE]: 'project',
  [PERMISSION.CAPACITY_PUBLISH]: 'project',
  // Project tier: every report is bounded by one Project, and Team is a filter inside
  // it. A workspace-tier report code would let a grant on one project read another's
  // velocity.
  [PERMISSION.REPORT_VIEW]: 'project',
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
 *   1. MONOTONIC TIERS — project_member ⊆ project_admin, and workspace_admin
 *      (via `workspace:*`) ⊇ everything. A higher role is always a strict
 *      superset of the one below it.
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
    PERMISSION.WORKSPACE_EDIT,
    PERMISSION.WORKSPACE_DELETE,
    PERMISSION.USERS_INVITE,
    PERMISSION.USERS_REMOVE,
    PERMISSION.USERS_ASSIGN_ROLE,
    PERMISSION.ROLES_VIEW,
    PERMISSION.ROLES_EDIT,
    PERMISSION.TEAMS_CREATE,
    PERMISSION.TEAMS_EDIT,
    PERMISSION.TEAMS_MANAGE_MEMBERS,
    PERMISSION.AUDIT_VIEW,
    PERMISSION.SCM_MANAGE,
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
    PERMISSION.MILESTONE_VIEW,
    PERMISSION.MILESTONE_CREATE,
    PERMISSION.MILESTONE_EDIT,
    PERMISSION.MILESTONE_DELETE,
    PERMISSION.PORTFOLIO_VIEW,
    PERMISSION.PORTFOLIO_CREATE,
    PERMISSION.PORTFOLIO_EDIT,
    PERMISSION.PORTFOLIO_ARCHIVE,
    PERMISSION.CAPACITY_VIEW,
    // A Project Admin turned Read-only keeps this and loses the two write codes, which is what
    // makes AC-012 ("still opening Draft and Published plans") expressible at all.
    PERMISSION.CAPACITY_VIEW_DRAFT,
    PERMISSION.CAPACITY_MANAGE,
    PERMISSION.CAPACITY_PUBLISH,
    PERMISSION.REPORT_VIEW,
  ],
  // Full DELIVERY control of an assigned project, but NOT its lifecycle or
  // membership. Per SRS Phase 4.2: project create/archive/restore/delete and
  // member management are workspace_admin-only (moved off project_admin).
  [SYSTEM_ROLE.PROJECT_ADMIN]: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.PROJECT_EDIT,
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
    PERMISSION.MILESTONE_VIEW,
    PERMISSION.MILESTONE_CREATE,
    PERMISSION.MILESTONE_EDIT,
    PERMISSION.MILESTONE_DELETE,
    PERMISSION.PORTFOLIO_VIEW,
    PERMISSION.PORTFOLIO_CREATE,
    PERMISSION.PORTFOLIO_EDIT,
    PERMISSION.PORTFOLIO_ARCHIVE,
    PERMISSION.CAPACITY_VIEW,
    // A Project Admin turned Read-only keeps this and loses the two write codes, which is what
    // makes AC-012 ("still opening Draft and Published plans") expressible at all.
    PERMISSION.CAPACITY_VIEW_DRAFT,
    PERMISSION.CAPACITY_MANAGE,
    PERMISSION.CAPACITY_PUBLISH,
    PERMISSION.REPORT_VIEW,
  ],
  // Delivery contributor inside ONE assigned project. Per SRS Phase 4.2 the
  // member can create AND delete US/DE + tasks (delete added); no iteration/
  // release/milestone management, no team capacity, no project settings.
  [SYSTEM_ROLE.PROJECT_MEMBER]: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.WORK_ITEM_CREATE,
    PERMISSION.WORK_ITEM_EDIT,
    PERMISSION.WORK_ITEM_DELETE,
    PERMISSION.ITERATION_VIEW,
    // Read-only portfolio access: the spec lets a Project Member see the Epics,
    // Features and capacity plans for their Project/Team but never mutate them.
    PERMISSION.PORTFOLIO_VIEW,
    PERMISSION.CAPACITY_VIEW,
    // Reports are read-only and describe the member's own delivery, so the delivery
    // tier reads them too. Export stays gated on a write permission in the UI.
    PERMISSION.REPORT_VIEW,
  ],
};

/**
 * Per-Project ACCESS LEVELS (RBAC migration — see
 * docs/superpowers/plans/rbac-migration.md). Replace the retiring
 * PROJECT_ADMIN / PROJECT_MEMBER tier roles. Carried on
 * work.project_members.access_level; no active row = No Access.
 *
 * admin  = full delivery administration in one Project (today's PROJECT_ADMIN set).
 * editor = team-scoped delivery contributor (today's PROJECT_MEMBER set; team
 *          scoping enforced in Phase 9).
 * viewer = Project-wide read-only.
 *
 * admin/editor DERIVE from the existing tier sets so they stay in lockstep until
 * the Phase 10 contract retires the tiers — no duplication to drift.
 */
export const PROJECT_ACCESS_LEVEL = ['admin', 'editor', 'viewer'] as const;
export type ProjectAccessLevel = (typeof PROJECT_ACCESS_LEVEL)[number];

export const ACCESS_LEVEL_PERMISSIONS: Record<ProjectAccessLevel, readonly Permission[]> = {
  admin: ROLE_PERMISSIONS[SYSTEM_ROLE.PROJECT_ADMIN],
  editor: ROLE_PERMISSIONS[SYSTEM_ROLE.PROJECT_MEMBER],
  viewer: [
    PERMISSION.PROJECT_VIEW,
    PERMISSION.WORK_ITEM_VIEW,
    PERMISSION.ITERATION_VIEW,
    PERMISSION.RELEASE_VIEW,
    PERMISSION.TEAM_STATUS_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.MILESTONE_VIEW,
    PERMISSION.PORTFOLIO_VIEW,
    PERMISSION.CAPACITY_VIEW,
    PERMISSION.CAPACITY_VIEW_DRAFT,
    PERMISSION.REPORT_VIEW,
  ],
};

/** Human-readable role names for the seed / admin UI. */
export const ROLE_NAMES: Record<SystemRoleSlug, string> = {
  [SYSTEM_ROLE.WORKSPACE_ADMIN]: 'Workspace Admin',
  [SYSTEM_ROLE.PROJECT_ADMIN]: 'Project Admin',
  [SYSTEM_ROLE.PROJECT_MEMBER]: 'Project Member',
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

/**
 * No preset persona roles in the Phase 4.2 baseline. The BA reconciliation
 * removed Scrum Master / Product Owner / Developer / QA (and Viewer) — the
 * product ships exactly three canonical roles (workspace_admin, project_admin,
 * project_member). Custom roles can still be authored per workspace later; this
 * list stays empty so nothing is seeded by default.
 */
export const PRESET_WORKSPACE_ROLES: readonly PresetWorkspaceRole[] = [];
