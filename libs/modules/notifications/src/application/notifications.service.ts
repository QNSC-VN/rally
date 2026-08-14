import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException } from '@platform';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import {
  INotificationRepository,
  NOTIFICATION_REPOSITORY,
} from '../domain/ports/notification.repository';
import {
  NOTIFICATION_CATEGORY_TYPES,
  type Notification,
  type CreateNotificationInput,
  type NotificationCategory,
} from '../domain/notification.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notificationRepo: INotificationRepository,
    private readonly access: AccessService,
  ) {}

  /**
   * The Project access fact behind every read of this feed.
   *
   * `Phase 4/02_Roles_Permissions/SRS.md` §7 :200 — "Notifications must apply the CURRENT
   * Project/Team access before displaying or routing to a Work Item". Resolved per request (never
   * from the token) so a revoked access level lands on the reader's NEXT request, exactly like the
   * guard; the underlying assignment read is cached for 5 minutes per (workspace, user).
   *
   * `work_item:view` is the permission because that is what the notification's target needs and what
   * the item-key resolver behind `/item/$itemKey` enforces — a bell entry the reader can see but not
   * open is the defect this closes, so the two must ask the same question.
   *
   * `null` means UNRESTRICTED and `[]` means "no projects". Both are passed through untouched:
   * flattening `null` to `[]` empties a Workspace Admin's bell, flattening `[]` to "all" leaks the
   * workspace.
   */
  private readableProjectIds(actor: JwtPayload): Promise<string[] | null> {
    return this.access.listReadableProjectIds(
      actor.workspaceId,
      actor.sub,
      PERMISSION.WORK_ITEM_VIEW,
    );
  }

  async listNotifications(
    actor: JwtPayload,
    filter: { unreadOnly: boolean; category?: NotificationCategory; limit?: number },
  ): Promise<Notification[]> {
    const types = filter.category ? NOTIFICATION_CATEGORY_TYPES[filter.category] : undefined;
    return this.notificationRepo.listForRecipient(
      actor.workspaceId,
      actor.sub,
      {
        unreadOnly: filter.unreadOnly,
        types,
        limit: filter.limit ?? 50,
      },
      await this.readableProjectIds(actor),
    );
  }

  /** Cursor-paginated feed for the full Notifications page (infinite scroll). */
  async listNotificationsPage(
    actor: JwtPayload,
    filter: { unreadOnly: boolean; category?: NotificationCategory },
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Notification>> {
    const types = filter.category ? NOTIFICATION_CATEGORY_TYPES[filter.category] : undefined;
    return this.notificationRepo.listPageForRecipient(
      actor.workspaceId,
      actor.sub,
      { unreadOnly: filter.unreadOnly, types },
      args,
      await this.readableProjectIds(actor),
    );
  }

  /**
   * `POST /notifications/:id/read` is the SEVENTH recipient seam, and the only one that WRITES.
   *
   * It used to check recipient + workspace alone, so the unread state of a notification the reader
   * is not allowed to see could be consumed by id alone. That state is reachable: the write side's
   * own recipient filter (`filterByProjectAccess`, FR-019) is applied to mentions and NOT to
   * assignments, so a notification can exist for a principal with no `work_item:view` on the item's
   * project. The consequence is the one `markAllRead`'s repository docblock refuses in the same
   * words — the row comes back already-read if access is later granted, so the unread badge the
   * reader would then be owed is gone for good. §7 :200 governs this write for the same reason it
   * governs the six reads.
   *
   * Gated on `isVisibleToRecipient`, the predicate the list, the page, the badge, the SSE replay,
   * the live push and `mark all read` all share — never a second definition of "visible" restated
   * in TypeScript over a fetched row, which is how a feed and its badge start disagreeing.
   *
   * NOT visible throws the SAME `NOTIFICATION_NOT_FOUND` this method already threw for a missing row
   * or another recipient's row, deliberately matching the sibling shape: it keeps "denied"
   * indistinguishable from "absent" (:199 — a denied state discloses no business data, and mere
   * existence under a known id is business data), and unlike a silent no-op it does not report a
   * write as having succeeded when nothing was written.
   */
  async markRead(actor: JwtPayload, notificationId: string): Promise<void> {
    if (!(await this.isVisible(actor, notificationId))) {
      throw new NotFoundException('NOTIFICATION_NOT_FOUND', 'Notification not found');
    }
    await this.notificationRepo.markRead(notificationId);
  }

  async markAllRead(actor: JwtPayload): Promise<void> {
    await this.notificationRepo.markAllRead(
      actor.workspaceId,
      actor.sub,
      await this.readableProjectIds(actor),
    );
  }

  async getUnreadCount(actor: JwtPayload): Promise<number> {
    return this.notificationRepo.countUnread(
      actor.workspaceId,
      actor.sub,
      await this.readableProjectIds(actor),
    );
  }

  /**
   * Returns notifications created after `afterId` (exclusive), oldest-first.
   * Called by the SSE controller on reconnect when the client sends
   * `Last-Event-ID` to replay events missed during the disconnected gap.
   */
  async listMissed(actor: JwtPayload, afterId: string, limit = 30): Promise<Notification[]> {
    return this.notificationRepo.listSince(
      actor.workspaceId,
      actor.sub,
      afterId,
      limit,
      await this.readableProjectIds(actor),
    );
  }

  /**
   * May this recipient be SHOWN this notification right now?
   *
   * The SSE live push is the one read that does not go through a list query — the worker relay
   * publishes to Valkey and the stream forwards the payload — so without this check the badge, the
   * page and the replay would apply §7's access filter and the real-time toast would not. That is
   * reachable: the write side's own recipient filter (`filterByProjectAccess`, FR-019) is applied to
   * mentions and not to assignments, so a notification CAN be created for a principal with no
   * `work_item:view` on the item's project.
   */
  async isVisible(actor: JwtPayload, notificationId: string): Promise<boolean> {
    return this.notificationRepo.isVisibleToRecipient(
      actor.workspaceId,
      actor.sub,
      notificationId,
      await this.readableProjectIds(actor),
    );
  }

  /** Internal use — called by other services / event handlers to emit notifications. */
  async send(input: Omit<CreateNotificationInput, 'id'>): Promise<Notification | null> {
    const notification = await this.notificationRepo.create({
      id: uuidv7(),
      ...input,
    });
    if (!notification) {
      this.logger.debug(
        { type: input.type },
        'Notification deduplicated (sourceEventId already exists)',
      );
      return null;
    }
    this.logger.debug({ notificationId: notification.id, type: input.type }, 'Notification sent');
    return notification;
  }
}
