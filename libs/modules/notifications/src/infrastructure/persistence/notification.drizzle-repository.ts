import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { inAppNotifications } from '../../../../../../db/schema/notifications';
import type { Notification, CreateNotificationInput } from '../../domain/notification.types';
import { INotificationRepository } from '../../domain/ports/notification.repository';

@Injectable()
export class NotificationDrizzleRepository implements INotificationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Notification | null> {
    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.id, id))
      .limit(1);
    return (rows[0] as Notification | undefined) ?? null;
  }

  async listForRecipient(
    tenantId: string,
    recipientId: string,
    unreadOnly: boolean,
    limit: number,
  ): Promise<Notification[]> {
    const conditions = [
      eq(inAppNotifications.tenantId, tenantId),
      eq(inAppNotifications.recipientId, recipientId),
    ];
    if (unreadOnly) {
      conditions.push(eq(inAppNotifications.isRead, false));
    }

    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(and(...conditions))
      .orderBy(desc(inAppNotifications.createdAt))
      .limit(limit);
    return rows as Notification[];
  }

  async create(input: CreateNotificationInput): Promise<Notification | null> {
    const rows = await this.db
      .insert(inAppNotifications)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        recipientId: input.recipientId,
        actorId: input.actorId,
        type: input.type,
        title: input.title,
        body: input.body,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata ?? {},
        isRead: false,
        sourceEventId: input.sourceEventId,
      })
      // When sourceEventId is non-null and already exists, return null (deduplicated).
      // When null, no conflict occurs (NULL != NULL in PG).
      .onConflictDoNothing({ target: inAppNotifications.sourceEventId })
      .returning();
    return (rows[0] as Notification | undefined) ?? null;
  }

  async countUnread(tenantId: string, recipientId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.tenantId, tenantId),
          eq(inAppNotifications.recipientId, recipientId),
          eq(inAppNotifications.isRead, false),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async markRead(id: string): Promise<void> {
    await this.db
      .update(inAppNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(inAppNotifications.id, id));
  }

  async markAllRead(tenantId: string, recipientId: string): Promise<void> {
    await this.db
      .update(inAppNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(inAppNotifications.tenantId, tenantId),
          eq(inAppNotifications.recipientId, recipientId),
          eq(inAppNotifications.isRead, false),
        ),
      );
  }

  /**
   * Returns notifications newer than afterId, oldest-first.
   * UUIDv7 stores a 48-bit Unix timestamp in the high bits so
   * lexicographic `>` is equivalent to chronological `>`.
   * Limit is capped at 50 to prevent unbounded replay on very stale clients.
   */
  async listSince(
    tenantId: string,
    recipientId: string,
    afterId: string,
    limit: number,
  ): Promise<Notification[]> {
    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.tenantId, tenantId),
          eq(inAppNotifications.recipientId, recipientId),
          gt(inAppNotifications.id, afterId),
        ),
      )
      .orderBy(asc(inAppNotifications.id))
      .limit(Math.min(limit, 50));
    return rows as Notification[];
  }
}
