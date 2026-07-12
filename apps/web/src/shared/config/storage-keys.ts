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
  LAST_ACCESSED_ITERATION: 'rally-last-accessed-iteration',
} as const
