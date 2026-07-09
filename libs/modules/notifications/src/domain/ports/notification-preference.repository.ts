import type {
  NotificationPreference,
  UpsertPreferenceInput,
} from '../notification-preference.types';

export const NOTIFICATION_PREFERENCE_REPOSITORY = Symbol('NOTIFICATION_PREFERENCE_REPOSITORY');

export interface INotificationPreferenceRepository {
  /** List all explicit preference rows for a user (for settings UI). */
  listForUser(workspaceId: string, userId: string): Promise<NotificationPreference[]>;

  /** Get a single preference row by type (or '*'). Returns null if no explicit preference. */
  findOne(workspaceId: string, userId: string, type: string): Promise<NotificationPreference | null>;

  /**
   * Fetch both the specific-type and wildcard ('*') rows in one query.
   * Used by isEnabled() to avoid two sequential round-trips per row in the relay batch.
   */
  findForCheck(workspaceId: string, userId: string, type: string): Promise<NotificationPreference[]>;

  /** Upsert a preference row. Only updates the channels that are provided. */
  upsert(input: UpsertPreferenceInput): Promise<NotificationPreference>;

  /** Delete a preference row (reverts to default = enabled). */
  delete(workspaceId: string, userId: string, type: string): Promise<void>;
}
