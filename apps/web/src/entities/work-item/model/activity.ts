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

/**
 * Actions whose `changes.field` does not name the thing that changed in the entity's OWN terms.
 *
 * `scheduleState` is the DTO/wire field on BOTH a work item and a task — it is mirrored onto
 * `work.tasks.state` — so `humanizeToken` renders a task's state change as "Schedule State", a
 * dimension a Task does not have (GAP-P1-HIST-002). The writer is already correct and must stay
 * that way: `activity-diff.ts` emits `task.state_changed` for a task and
 * `work_item.schedule_state_changed` for an item, while keeping one field NAME for both.
 *
 * Keyed on the ACTION, deliberately, for two reasons. It is the only discriminant that is true of
 * the row rather than of the request that produced it (`changes.field` is shared by both entities,
 * so a per-field rename would relabel a work item's own Schedule State too), and it repairs every
 * row already written — a writer-side fix would relabel future rows only and leave the history the
 * BA was reading untouched.
 *
 * The copy is the app's existing label for the field: `sidebar.taskState` in
 * `shared/i18n/locales/en/work-items.json`. It is a literal here rather than a `t()` lookup because
 * the whole Description is an un-internationalised English sentence ("changed from", "(empty)");
 * translating one noun inside it would read worse than leaving it, and threading a translator into
 * a pure model function for one word buys nothing. When the sentence is internationalised, this map
 * becomes a key map and moves with it.
 */
const FIELD_LABEL_BY_ACTION: Record<string, string> = {
  'task.state_changed': 'Task State',
}

/**
 * The label for the field an activity row changed — the action's override where one exists,
 * otherwise the humanised field name. Exported for its own spec.
 */
export function activityFieldLabel(log: ActivityLike): string {
  return FIELD_LABEL_BY_ACTION[log.action] ?? humanizeToken(log.changes?.field ?? log.action)
}

/** Build a Rally-style revision Description from an activity-log entry. */
export function describeActivity(log: ActivityLike): string {
  if (log.changes) {
    return `${activityFieldLabel(log)} changed from ${formatActivityValue(
      log.changes.old,
    )} to ${formatActivityValue(log.changes.new)}`
  }
  return humanizeToken(log.action)
}
