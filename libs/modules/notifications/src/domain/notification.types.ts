/**
 * Notification Center category filters (Notification Center mockup tabs:
 * All / Unread / Assigned / Mentions). Maps a UI category to the underlying
 * notification template `type` values. Single source of truth — the server
 * filters on these type sets so the client never hard-codes template names.
 */
export const NOTIFICATION_CATEGORY_TYPES = {
  assigned: ['WORK_ITEM_ASSIGNED'],
  mentions: ['WORK_ITEM_MENTIONED'],
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORY_TYPES;

/** Filter passed from the application layer to the repository list query. */
export interface NotificationListFilter {
  unreadOnly: boolean;
  /** Restrict to these notification `type` values (resolved from a category). */
  types?: readonly string[];
  limit: number;
}

export interface Notification {
  id: string;
  workspaceId: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  sourceEventId: string | null;
}

export interface CreateNotificationInput {
  id: string;
  workspaceId: string;
  recipientId: string;
  actorId?: string;
  type: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  /** Outbox eventId — used for at-most-once deduplication via ON CONFLICT DO NOTHING. */
  sourceEventId?: string;
}
