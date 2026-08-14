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

  async markRead(actor: JwtPayload, notificationId: string): Promise<void> {
    const notification = await this.notificationRepo.findById(notificationId);
    if (
      !notification ||
      notification.recipientId !== actor.sub ||
      notification.workspaceId !== actor.workspaceId
    ) {
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
