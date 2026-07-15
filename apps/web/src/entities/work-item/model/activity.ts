/**
 * Activity-log presentation helpers — shared by every place that renders the
 * work-item revision history / activity feed (detail Revision History tab,
 * dashboards, timelines). Pure functions kept in the entity model so the
 * humanisation logic has a single source of truth. Accepts a minimal structural
 * shape so it stays decoupled from any feature-layer response type.
 */

export interface ActivityChange {
  field: string
  old: unknown
  new: unknown
}

export interface ActivityLike {
  action: string
  changes: ActivityChange | null
}

/** Convert a camelCase / snake_case / dotted token into a Title-Cased phrase. */
export function humanizeToken(token: string): string {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Render an activity-log field value for display in a revision Description. */
export function formatActivityValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Build a Rally-style revision Description from an activity-log entry. */
export function describeActivity(log: ActivityLike): string {
  if (log.changes) {
    return `${humanizeToken(log.changes.field)} changed from ${formatActivityValue(
      log.changes.old,
    )} to ${formatActivityValue(log.changes.new)}`
  }
  return humanizeToken(log.action)
}
