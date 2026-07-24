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
  PROJECTS_COLUMNS: 'rally-projects-columns',
  ITERATIONS_COLUMNS: 'rally-iterations-columns',
  WORK_ITEM_TASKS_COLUMNS: 'rally-work-item-tasks-columns',
  SCM_CONNECTIONS_COLUMNS: 'rally-scm-connections-columns',
  SCM_CHANGESETS_COLUMNS: 'rally-scm-changesets-columns',
  LAST_ACCESSED_ITERATION: 'rally-last-accessed-iteration',
  ITERATION_STATUS_VIEW_MODE: 'rally-iteration-status-view-mode',
} as const
