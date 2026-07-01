import type { Notification, CreateNotificationInput } from '../notification.types';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

export interface INotificationRepository {
  findById(id: string): Promise<Notification | null>;
  listForRecipient(
    tenantId: string,
    recipientId: string,
    unreadOnly: boolean,
    limit: number,
  ): Promise<Notification[]>;
  /**
   * Returns unread notifications newer than afterId (exclusive), ordered oldest-first.
   * Used by the SSE controller to replay events missed during a reconnect gap.
   * afterId is a UUIDv7 — lexicographic > is equivalent to chronological > because
   * UUIDv7 encodes a 48-bit millisecond timestamp in the high bits.
   */
  listSince(
    tenantId: string,
    recipientId: string,
    afterId: string,
    limit: number,
  ): Promise<Notification[]>;
  /** Idempotent — returns null when sourceEventId already exists (deduplicated). */
  create(input: CreateNotificationInput): Promise<Notification | null>;
  countUnread(tenantId: string, recipientId: string): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(tenantId: string, recipientId: string): Promise<void>;
}
