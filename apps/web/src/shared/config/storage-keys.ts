/**
 * Centralized localStorage key registry.
 * All localStorage keys should be declared here to prevent collisions and typos.
 */
export const STORAGE_KEYS = {
  BACKLOG_COLUMN_WIDTHS: 'rally-backlog-col-widths',
  WI_SIDEBAR_COLLAPSED: 'wi-sidebar-collapsed',
  ITERATION_STATUS_COLUMNS: 'rally-iteration-status-columns',
  TEAM_STATUS_COLUMNS: 'rally-team-status-columns',
  RELEASES_COLUMNS: 'rally-releases-columns',
  QUALITY_COLUMNS: 'rally-quality-columns',
  MILESTONES_COLUMNS: 'rally-milestones-columns',
  PORTFOLIO_COLUMNS: 'rally-portfolio-columns',
  CAPACITY_PLAN_COLUMNS: 'rally-capacity-plan-columns',
  // v2: End Date column added — bump invalidates stale saved layouts so the new
  // column lands in its declared position (after Start Date) instead of drifting.
  PROJECTS_COLUMNS: 'rally-projects-columns-v2',
  ITERATIONS_COLUMNS: 'rally-iterations-columns',
  WORK_ITEM_TASKS_COLUMNS: 'rally-work-item-tasks-columns',
  SCM_CONNECTIONS_COLUMNS: 'rally-scm-connections-columns',
  SCM_CHANGESETS_COLUMNS: 'rally-scm-changesets-columns',
  SETTINGS_USERS_COLUMNS: 'rally-settings-users-columns',
  SETTINGS_TEAMS_COLUMNS: 'rally-settings-teams-columns',
  SETTINGS_AUDIT_COLUMNS: 'rally-settings-audit-columns',
  LAST_ACCESSED_ITERATION: 'rally-last-accessed-iteration',
  ITERATION_STATUS_VIEW_MODE: 'rally-iteration-status-view-mode',
  // Which unit the portfolio detail's "Total Accepted Children" panel opens in, set from
  // that panel's gear — Rally keeps the same choice per user.
  ACCEPTED_CHILDREN_UNIT: 'rally-accepted-children-unit',
} as const
