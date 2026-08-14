import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
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

  /**
   * The Project access predicate every read of this table shares.
   *
   * `Phase 4/02_Roles_Permissions/SRS.md` §7 :200 — "Notifications must apply the CURRENT
   * Project/Team access before displaying or routing to a Work Item" — and :199 — "Denied states
   * must not show restricted title, owner, Project, Team or other business data". The feed used to
   * filter on workspace + recipient alone, so every past notification for a project the reader had
   * since lost stayed in the bell naming its work item, and clicking one routed to `/item/$itemKey`
   * whose resolver 403s: the title was disclosed on precisely the surface §7 says discloses nothing.
   *
   * Applied HERE rather than in each query so the list, the cursor page, the unread COUNT, the SSE
   * replay and `mark all read` cannot disagree. A bell badge counting rows the page then refuses to
   * show is its own defect.
   *
   * The project a notification is ABOUT lives in `metadata->>'projectId'`, not in `resource_id`
   * (which is the work item's own id). Every work-item template threads it —
   * `WorkItemNotificationVars` in `@platform/notifications` — precisely so a client can open the
   * item in its OWN project context.
   *
   * Sentinel contract, identical to `project.drizzle-repository.ts`: `null` is UNRESTRICTED (a
   * workspace-wide grant, i.e. Workspace Admin) and an array — INCLUDING an empty one — restricts.
   * Flattening `null` to `[]` shows an admin an empty bell; flattening `[]` to "all" leaks the
   * whole workspace. `inArray(col, [])` is never emitted, because it is not portable as
   * "match nothing".
   *
   * DECISION — a notification that names NO project stays VISIBLE, and the empty-array case is
   * therefore a condition rather than the projects repository's whole-query short-circuit.
   * `WORKSPACE_INVITATION` / `WORKSPACE_INVITATION_ACCEPTED` are workspace-scoped by design and
   * carry no `projectId`; dropping every project-less row would silently delete the only surface
   * that onboards a user, and "it has no project" is not "its project is denied". So the rule is
   * "hide a notification that names a project this reader cannot read", never "keep only
   * notifications whose project is readable".
   */
  private projectAccessCondition(readableProjectIds: string[] | null): SQL | undefined {
    if (readableProjectIds === null) return undefined;
    const namedProject = sql<string | null>`${inAppNotifications.metadata} ->> 'projectId'`;
    if (readableProjectIds.length === 0) return isNull(namedProject);
    return or(isNull(namedProject), inArray(namedProject, readableProjectIds));
  }

  /** Base predicate for every recipient-scoped read: identity + Project access. */
  private recipientConditions(
    workspaceId: string,
    recipientId: string,
    readableProjectIds: string[] | null,
  ): SQL[] {
    const conditions: SQL[] = [
      eq(inAppNotifications.workspaceId, workspaceId),
      eq(inAppNotifications.recipientId, recipientId),
    ];
    const access = this.projectAccessCondition(readableProjectIds);
    if (access) conditions.push(access);
    return conditions;
  }

  /**
   * Existence check for ONE row under the same access predicate as the list, so the SSE live push
   * can refuse a notification the Notification Center would not show. Deliberately reuses
   * `recipientConditions` rather than re-stating the rule in TypeScript over a fetched row: two
   * implementations of "visible" is how a feed and its badge start disagreeing.
   */
  async isVisibleToRecipient(
    workspaceId: string,
    recipientId: string,
    notificationId: string,
    readableProjectIds: string[] | null,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(
        and(
          ...this.recipientConditions(workspaceId, recipientId, readableProjectIds),
          eq(inAppNotifications.id, notificationId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listForRecipient(
    workspaceId: string,
    recipientId: string,
    filter: NotificationListFilter,
    readableProjectIds: string[] | null,
  ): Promise<Notification[]> {
    const conditions = this.recipientConditions(workspaceId, recipientId, readableProjectIds);
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
      .orderBy(desc(inAppNotifications.createdAt), asc(inAppNotifications.id))
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
    readableProjectIds: string[] | null,
  ): Promise<PagedResult<Notification>> {
    const conditions = this.recipientConditions(workspaceId, recipientId, readableProjectIds);
    if (filter.unreadOnly) conditions.push(eq(inAppNotifications.isRead, false));
    if (filter.types && filter.types.length > 0) {
      conditions.push(inArray(inAppNotifications.type, [...filter.types]));
    }
    if (cursor) {
      // Hand-rolled previously, to dodge keysetCondition binding the cursor's
      // ISO string straight into a timestamptz comparison. It carried a subtler
      // bug of its own: `new Date(...)` is millisecond-precision while the stored
      // value is microsecond, so `lt` also excluded every row inside the cursor's
      // millisecond. keysetCondition now reads the boundary back from the row by
      // id for date columns, which is exact, so use it.
      conditions.push(keysetCondition(inAppNotifications.createdAt, inAppNotifications.id, cursor));
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

  async countUnread(
    workspaceId: string,
    recipientId: string,
    readableProjectIds: string[] | null,
  ): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(inAppNotifications)
      .where(
        and(
          ...this.recipientConditions(workspaceId, recipientId, readableProjectIds),
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

  /**
   * Scoped by the same access predicate as `countUnread`, so "mark all read" clears exactly the
   * rows the badge was counting. Unfiltered it would silently consume the unread state of a
   * notification the reader was never shown, and if their access were later restored the item
   * would surface already-read.
   */
  async markAllRead(
    workspaceId: string,
    recipientId: string,
    readableProjectIds: string[] | null,
  ): Promise<void> {
    await this.db
      .update(inAppNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          ...this.recipientConditions(workspaceId, recipientId, readableProjectIds),
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
    readableProjectIds: string[] | null,
  ): Promise<Notification[]> {
    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(
        and(
          ...this.recipientConditions(workspaceId, recipientId, readableProjectIds),
          gt(inAppNotifications.id, afterId),
        ),
      )
      .orderBy(asc(inAppNotifications.id))
      .limit(Math.min(limit, 50));
    return rows as Notification[];
  }
}
