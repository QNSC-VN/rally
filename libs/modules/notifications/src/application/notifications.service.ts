import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException } from '@platform';
import type { JwtPayload } from '@platform';
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
  ) {}

  async listNotifications(
    actor: JwtPayload,
    filter: { unreadOnly: boolean; category?: NotificationCategory; limit?: number },
  ): Promise<Notification[]> {
    const types = filter.category ? NOTIFICATION_CATEGORY_TYPES[filter.category] : undefined;
    return this.notificationRepo.listForRecipient(actor.workspaceId, actor.sub, {
      unreadOnly: filter.unreadOnly,
      types,
      limit: filter.limit ?? 50,
    });
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
    await this.notificationRepo.markAllRead(actor.workspaceId, actor.sub);
  }

  async getUnreadCount(actor: JwtPayload): Promise<number> {
    return this.notificationRepo.countUnread(actor.workspaceId, actor.sub);
  }

  /**
   * Returns notifications created after `afterId` (exclusive), oldest-first.
   * Called by the SSE controller on reconnect when the client sends
   * `Last-Event-ID` to replay events missed during the disconnected gap.
   */
  async listMissed(actor: JwtPayload, afterId: string, limit = 30): Promise<Notification[]> {
    return this.notificationRepo.listSince(actor.workspaceId, actor.sub, afterId, limit);
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
