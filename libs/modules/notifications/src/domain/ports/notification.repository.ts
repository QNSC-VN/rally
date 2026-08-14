import type { CursorPayload, PagedResult } from '@platform';
import type {
  Notification,
  CreateNotificationInput,
  NotificationListFilter,
} from '../notification.types';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

/**
 * `readableProjectIds` — the Project access fact from
 * `AccessService.listReadableProjectIds(ws, user, 'work_item:view')`, threaded into every
 * recipient-scoped read so `Phase 4/02_Roles_Permissions/SRS.md` §7 :199-200 is applied before a
 * work item's title is displayed. `null` means UNRESTRICTED (a workspace-wide grant, i.e. Workspace
 * Admin); an array — INCLUDING an empty one — restricts. It is a required parameter on purpose: an
 * optional one would let a new call site read the whole workspace by omission, which is how the
 * gap existed in the first place.
 */
export interface INotificationRepository {
  /**
   * True when the row exists, belongs to this recipient AND passes the Project access filter.
   *
   * This is deliberately the ONLY single-row read on the port. An unfiltered `findById` used to sit
   * beside it and was `markRead`'s gate, which is how that seam came to authorize a write on
   * recipient + workspace with no access check; a by-id read that cannot express the access fact is
   * the same footgun as an optional `readableProjectIds`.
   */
  isVisibleToRecipient(
    workspaceId: string,
    recipientId: string,
    notificationId: string,
    readableProjectIds: string[] | null,
  ): Promise<boolean>;
  listForRecipient(
    workspaceId: string,
    recipientId: string,
    filter: NotificationListFilter,
    readableProjectIds: string[] | null,
  ): Promise<Notification[]>;
  listPageForRecipient(
    workspaceId: string,
    recipientId: string,
    filter: { unreadOnly: boolean; types?: readonly string[] },
    args: { limit: number; cursor: CursorPayload | null },
    readableProjectIds: string[] | null,
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
    readableProjectIds: string[] | null,
  ): Promise<Notification[]>;
  /** Idempotent — returns null when sourceEventId already exists (deduplicated). */
  create(input: CreateNotificationInput): Promise<Notification | null>;
  countUnread(
    workspaceId: string,
    recipientId: string,
    readableProjectIds: string[] | null,
  ): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(
    workspaceId: string,
    recipientId: string,
    readableProjectIds: string[] | null,
  ): Promise<void>;
}
