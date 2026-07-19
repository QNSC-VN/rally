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
  WORKSPACE_MANAGE_MEMBERS: 'workspace:manage_members',
  WORKSPACE_MANAGE_TEAMS: 'workspace:manage_teams',

  PROJECT_EDIT: 'project:edit',
  PROJECT_MANAGE_MEMBERS: 'project:manage_members',

  ITERATION_VIEW: 'iteration:view',
  ITERATION_CREATE: 'iteration:create',
  ITERATION_EDIT: 'iteration:edit',
  ITERATION_DELETE: 'iteration:delete',
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
} as const

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION]
