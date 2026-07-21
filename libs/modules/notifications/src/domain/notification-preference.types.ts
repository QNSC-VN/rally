/**
 * Notification preference types.
 *
 * A preference row explicitly opts a user in/out of a notification channel
 * for a specific event type (or '*' for all types).
 *
 * Resolution order (most specific wins):
 *   1. Exact type match  (type = 'WORK_ITEM_ASSIGNED' — a NotificationTemplateName)
 *   2. Wildcard          (type = '*')
 *   3. Default           (no row → enabled)
 */
export interface NotificationPreference {
  id: string;
  workspaceId: string;
  userId: string;
  /** A NotificationTemplateName (e.g. 'WORK_ITEM_ASSIGNED') or '*' for the wildcard master switch. */
  type: string;
  inApp: boolean;
  email: boolean;
  updatedAt: Date;
}

export interface UpsertPreferenceInput {
  workspaceId: string;
  userId: string;
  type: string;
  inApp?: boolean;
  email?: boolean;
}

/** Internal: which delivery channel to query. */
export type NotificationChannel = 'in_app' | 'email';
