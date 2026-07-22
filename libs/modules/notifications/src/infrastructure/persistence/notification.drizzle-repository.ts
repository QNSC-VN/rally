import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import { inAppNotifications } from '../../../../../../db/schema/notifications';
import type {
  Notification,
  CreateNotificationInput,
  NotificationListFilter,
} from '../../domain/notification.types';
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
    workspaceId: string,
    recipientId: string,
    filter: NotificationListFilter,
  ): Promise<Notification[]> {
    const conditions = [
      eq(inAppNotifications.workspaceId, workspaceId),
      eq(inAppNotifications.recipientId, recipientId),
    ];
    if (filter.unreadOnly) {
      conditions.push(eq(inAppNotifications.isRead, false));
    }
    if (filter.types && filter.types.length > 0) {
      conditions.push(inArray(inAppNotifications.type, [...filter.types]));
    }

    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(and(...conditions))
      .orderBy(desc(inAppNotifications.createdAt))
      .limit(filter.limit);
    return rows as Notification[];
  }

  /**
   * Cursor-paginated recipient feed for the full Notifications page — newest
   * first, keyset ("seek") on created_at desc with the id as tie-breaker so
   * paging stays correct as new notifications arrive at the head.
   */
  async listPageForRecipient(
    workspaceId: string,
    recipientId: string,
    filter: { unreadOnly: boolean; types?: readonly string[] },
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Notification>> {
    const conditions = [
      eq(inAppNotifications.workspaceId, workspaceId),
      eq(inAppNotifications.recipientId, recipientId),
    ];
    if (filter.unreadOnly) conditions.push(eq(inAppNotifications.isRead, false));
    if (filter.types && filter.types.length > 0) {
      conditions.push(inArray(inAppNotifications.type, [...filter.types]));
    }
    if (cursor) {
      // DESC keyset with the id as tie-breaker. The cursor value is an ISO
      // string; convert to a Date so drizzle binds the timestamptz param
      // correctly (keysetCondition would pass the raw string and fail).
      const cv = new Date(cursor.k[0] as string);
      conditions.push(
        or(
          lt(inAppNotifications.createdAt, cv),
          and(eq(inAppNotifications.createdAt, cv), gt(inAppNotifications.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(and(...conditions))
      .orderBy(desc(inAppNotifications.createdAt), asc(inAppNotifications.id))
      .limit(limit + 1);

    return buildPageResult(
      rows as Notification[],
      limit,
      (n) => [new Date(n.createdAt).toISOString()],
      'desc',
    );
  }

  async create(input: CreateNotificationInput): Promise<Notification | null> {
    const rows = await this.db
      .insert(inAppNotifications)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
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

  async countUnread(workspaceId: string, recipientId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.workspaceId, workspaceId),
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

  async markAllRead(workspaceId: string, recipientId: string): Promise<void> {
    await this.db
      .update(inAppNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(inAppNotifications.workspaceId, workspaceId),
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
    workspaceId: string,
    recipientId: string,
    afterId: string,
    limit: number,
  ): Promise<Notification[]> {
    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.workspaceId, workspaceId),
          eq(inAppNotifications.recipientId, recipientId),
          gt(inAppNotifications.id, afterId),
        ),
      )
      .orderBy(asc(inAppNotifications.id))
      .limit(Math.min(limit, 50));
    return rows as Notification[];
  }
}
