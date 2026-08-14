/**
 * Permission codes used for frontend gating.
 *
 * These MUST match the backend catalogue (db/permissions.catalog.ts, surfaced
 * as @shared-kernel PERMISSION). The SPA is a separate Vite build without the
 * server path alias, so the codes are mirrored here rather than imported to
 * avoid pulling server code into the browser bundle. Keep the two in sync — the
 * backend is the source of truth; this is a view of it.
 *
 * Gating rule (auth store hasPermission): `workspace:*` grants everything; a
 * `ns:*` wildcard grants that namespace; otherwise an exact match is required.
 */
export const PERMISSION = {
  WORKSPACE_ALL: 'workspace:*',
  WORKSPACE_VIEW: 'workspace:view',

  // Company member/role/team/integration management (split out of the former
  // coarse workspace:manage_members / manage_teams — see db/permissions.catalog).
  USERS_ASSIGN_ROLE: 'users:assign_role',
  ROLES_VIEW: 'roles:view',
  ROLES_EDIT: 'roles:edit',
  TEAMS_CREATE: 'teams:create',
  AUDIT_VIEW: 'audit:view',
  SCM_MANAGE: 'scm:manage',

  // Held by every per-Project access level, so it is the code that answers "may this user see
  // this project at all" — the gate for a surface §3.1 shows to Admin and Editor and varies only
  // by scope. It was missing from this mirror while `app-shell.tsx` gated the Portfolio nav on the
  // bare string `'project:view'`, which typechecks and drifts silently.
  PROJECT_VIEW: 'project:view',
  PROJECT_EDIT: 'project:edit',
  PROJECT_MANAGE_MEMBERS: 'project:manage_members',

  // The timebox READ every delivery surface needs (Backlog filter, Team Status and Quality
  // pickers, Iteration Status). Every access level holds it, so it gates nothing on its own.
  ITERATION_VIEW: 'iteration:view',
  ITERATION_CREATE: 'iteration:create',
  ITERATION_EDIT: 'iteration:edit',
  ITERATION_DELETE: 'iteration:delete',
  // The `Plan > Timeboxes` SURFACE, which §3.2 marks Hidden for an Editor. This is the code
  // the nav entry and the switcher's `Iterations` type gate on — gating them on
  // ITERATION_VIEW showed an Editor a screen the BA hides and then offered a Releases mode
  // that 403'd. Its own namespace on purpose: the screen hosts all three timebox types, and
  // `iteration:manage` is a retired string (migration 0048) that must not be recycled.
  TIMEBOX_VIEW: 'timebox:view',
  RELEASE_VIEW: 'release:view',
  RELEASE_CREATE: 'release:create',
  RELEASE_EDIT: 'release:edit',
  RELEASE_DELETE: 'release:delete',
  TEAM_STATUS_VIEW: 'team_status:view',
  TEAM_STATUS_EDIT: 'team_status:edit',
  MILESTONE_VIEW: 'milestone:view',
  MILESTONE_CREATE: 'milestone:create',
  MILESTONE_EDIT: 'milestone:edit',
  MILESTONE_DELETE: 'milestone:delete',
  QUALITY_VIEW: 'quality:view',
  // Reports (Iteration Burndown / Velocity / Team Capacity) and Release Tracking.
  REPORT_VIEW: 'report:view',
} as const

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION]
