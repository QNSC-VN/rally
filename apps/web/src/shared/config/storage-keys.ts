/**
 * Centralized localStorage key registry.
 * All localStorage keys should be declared here to prevent collisions and typos.
 */
export const STORAGE_KEYS = {
  BACKLOG_COLUMN_WIDTHS: 'rally-backlog-col-widths',
  WI_SIDEBAR_COLLAPSED: 'wi-sidebar-collapsed',
} as const
