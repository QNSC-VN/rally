import type { CursorPayload, PagedResult } from '@platform';
import type {
  Notification,
  CreateNotificationInput,
  NotificationListFilter,
} from '../notification.types';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

export interface INotificationRepository {
  findById(id: string): Promise<Notification | null>;
  listForRecipient(
    workspaceId: string,
    recipientId: string,
    filter: NotificationListFilter,
  ): Promise<Notification[]>;
  listPageForRecipient(
    workspaceId: string,
    recipientId: string,
    filter: { unreadOnly: boolean; types?: readonly string[] },
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Notification>>;
  /**
   * Returns unread notifications newer than afterId (exclusive), ordered oldest-first.
   * Used by the SSE controller to replay events missed during a reconnect gap.
   * afterId is a UUIDv7 — lexicographic > is equivalent to chronological > because
   * UUIDv7 encodes a 48-bit millisecond timestamp in the high bits.
   */
  listSince(
    workspaceId: string,
    recipientId: string,
    afterId: string,
    limit: number,
  ): Promise<Notification[]>;
  /** Idempotent — returns null when sourceEventId already exists (deduplicated). */
  create(input: CreateNotificationInput): Promise<Notification | null>;
  countUnread(workspaceId: string, recipientId: string): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(workspaceId: string, recipientId: string): Promise<void>;
}
