import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, or, ilike, inArray, sql, desc } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import { workItems, workItemLabels, labels } from '../../../../../../db/schema/work';
import type {
  WorkItem,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemFilters,
  TaskTotals,
} from '../../domain/work-item.types';
import { IWorkItemRepository } from '../../domain/ports/work-item.repository';

@Injectable()
export class WorkItemDrizzleRepository implements IWorkItemRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<WorkItem | null> {
    const rows = await this.db
      .select()
      .from(workItems)
      .where(and(eq(workItems.id, id), isNull(workItems.deletedAt)))
      .limit(1);
    return (rows[0] as WorkItem | undefined) ?? null;
  }

  /** Shared filter builder for list/backlog queries. */
  private buildFilters(
    projectId: string,
    tenantId: string,
    filters: WorkItemFilters,
  ): ReturnType<typeof and>[] {
    const conditions = [
      eq(workItems.projectId, projectId),
      eq(workItems.tenantId, tenantId),
      isNull(workItems.deletedAt),
    ];

    if (filters.type) conditions.push(eq(workItems.type, filters.type));
    if (filters.statusId) conditions.push(eq(workItems.statusId, filters.statusId));
    if (filters.scheduleState) conditions.push(eq(workItems.scheduleState, filters.scheduleState));
    if (filters.priority) conditions.push(eq(workItems.priority, filters.priority));
    if (filters.assigneeId) conditions.push(eq(workItems.assigneeId, filters.assigneeId));
    if (filters.teamId) conditions.push(eq(workItems.teamId, filters.teamId));
    if (filters.iterationId) conditions.push(eq(workItems.iterationId, filters.iterationId));
    if (filters.releaseId) conditions.push(eq(workItems.releaseId, filters.releaseId));
    if (filters.q) {
      const term = filters.q.trim();
      if (term) {
        // Use Postgres full-text search (GIN index on search_vector, migration 0012).
        // Falls back gracefully to ILIKE on item_key for exact key lookups (e.g. "E2E-1").
        // plainto_tsquery handles multi-word queries without special syntax from the user.
        conditions.push(
          or(
            ilike(workItems.itemKey, term),
            sql`${workItems.searchVector} @@ plainto_tsquery('english', ${term})`,
          )!,
        );
      }
    }
    return conditions;
  }

  async listByProject(
    projectId: string,
    tenantId: string,
    filters: WorkItemFilters,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>> {
    const conditions = this.buildFilters(projectId, tenantId, filters);
    if (cursor) {
      conditions.push(lt(workItems.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(workItems)
      .where(and(...conditions))
      .orderBy(desc(workItems.createdAt))
      .limit(limit + 1);

    return buildPageResult(rows as WorkItem[], limit, (w) => [w.createdAt.toISOString()]);
  }

  async listBacklog(
    projectId: string,
    tenantId: string,
    filters: WorkItemFilters,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>> {
    const conditions = this.buildFilters(projectId, tenantId, filters);
    // Backlog shows only story + defect (tasks live under their parent item).
    conditions.push(inArray(workItems.type, ['story', 'defect']));
    if (cursor) {
      conditions.push(lt(workItems.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(workItems)
      .where(and(...conditions))
      .orderBy(desc(workItems.createdAt))
      .limit(limit + 1);

    return buildPageResult(rows as WorkItem[], limit, (w) => [w.createdAt.toISOString()]);
  }

  async listTasksByParent(parentId: string, tenantId: string): Promise<WorkItem[]> {
    const rows = await this.db
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.parentId, parentId),
          eq(workItems.tenantId, tenantId),
          eq(workItems.type, 'task'),
          isNull(workItems.deletedAt),
        ),
      )
      .orderBy(workItems.rank, workItems.createdAt);
    return rows as WorkItem[];
  }

  async getTaskTotals(parentId: string, tenantId: string): Promise<TaskTotals> {
    const rows = await this.db
      .select({
        taskCount: sql<number>`count(*)::int`,
        estimateHours: sql<string>`coalesce(sum(${workItems.estimateHours}), 0)`,
        todoHours: sql<string>`coalesce(sum(${workItems.todoHours}), 0)`,
        actualHours: sql<string>`coalesce(sum(${workItems.actualHours}), 0)`,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.parentId, parentId),
          eq(workItems.tenantId, tenantId),
          eq(workItems.type, 'task'),
          isNull(workItems.deletedAt),
        ),
      );
    const r = rows[0];
    return {
      taskCount: Number(r?.taskCount ?? 0),
      estimateHours: Number(r?.estimateHours ?? 0),
      todoHours: Number(r?.todoHours ?? 0),
      actualHours: Number(r?.actualHours ?? 0),
    };
  }

  async create(input: CreateWorkItemInput, executor?: DbExecutor): Promise<WorkItem> {
    const exec = executor ?? this.db;
    const rows = await exec
      .insert(workItems)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        itemKey: input.itemKey,
        type: input.type,
        title: input.title,
        description: input.description,
        statusId: input.statusId,
        scheduleState: input.scheduleState ?? 'defined',
        priority: input.priority,
        assigneeId: input.assigneeId,
        reporterId: input.reporterId,
        parentId: input.parentId,
        teamId: input.teamId,
        storyPoints: input.storyPoints,
        estimateHours: input.estimateHours,
        todoHours: input.todoHours,
        actualHours: input.actualHours,
        acceptanceCriteria: input.acceptanceCriteria,
        notes: input.notes,
        releaseNotes: input.releaseNotes,
        rank: input.rank,
        createdBy: input.createdBy,
      })
      .returning();
    return rows[0] as WorkItem;
  }

  async update(id: string, input: UpdateWorkItemInput, executor?: DbExecutor): Promise<WorkItem> {
    const exec = executor ?? this.db;
    const rows = await exec
      .update(workItems)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.statusId !== undefined && { statusId: input.statusId }),
        ...(input.scheduleState !== undefined && { scheduleState: input.scheduleState }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        ...(input.reporterId !== undefined && { reporterId: input.reporterId }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.teamId !== undefined && { teamId: input.teamId }),
        ...(input.iterationId !== undefined && { iterationId: input.iterationId }),
        ...(input.releaseId !== undefined && { releaseId: input.releaseId }),
        ...(input.storyPoints !== undefined && { storyPoints: input.storyPoints }),
        ...(input.estimateHours !== undefined && { estimateHours: input.estimateHours }),
        ...(input.todoHours !== undefined && { todoHours: input.todoHours }),
        ...(input.actualHours !== undefined && { actualHours: input.actualHours }),
        ...(input.acceptanceCriteria !== undefined && {
          acceptanceCriteria: input.acceptanceCriteria,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.releaseNotes !== undefined && { releaseNotes: input.releaseNotes }),
        ...(input.isBlocked !== undefined && { isBlocked: input.isBlocked }),
        ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
        ...(input.rank !== undefined && { rank: input.rank }),
        ...(input.customFields !== undefined && { customFields: input.customFields }),
        ...(input.updatedBy !== undefined && { updatedBy: input.updatedBy }),
        updatedAt: new Date(),
      })
      .where(eq(workItems.id, id))
      .returning();
    return rows[0] as WorkItem;
  }

  async softDelete(id: string, executor?: DbExecutor): Promise<void> {
    const exec = executor ?? this.db;
    await exec
      .update(workItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workItems.id, id));
  }

  async reorderItems(
    items: Array<{ id: string; rank: string }>,
    tenantId: string,
    executor?: DbExecutor,
  ): Promise<void> {
    if (items.length === 0) return;
    const exec = executor ?? this.db;
    // Single transaction — caller (service) wraps this in uow.run() for
    // atomicity + RLS activation. The tenant_id guard here is belt-and-
    // suspenders: even if called outside UoW it cannot write across tenants.
    await Promise.all(
      items.map(({ id, rank }) =>
        exec
          .update(workItems)
          .set({ rank, updatedAt: new Date() })
          .where(and(eq(workItems.id, id), eq(workItems.tenantId, tenantId))),
      ),
    );
  }

  async addLabel(workItemId: string, labelId: string): Promise<void> {
    await this.db.insert(workItemLabels).values({ workItemId, labelId }).onConflictDoNothing();
  }

  async removeLabel(workItemId: string, labelId: string): Promise<void> {
    await this.db
      .delete(workItemLabels)
      .where(and(eq(workItemLabels.workItemId, workItemId), eq(workItemLabels.labelId, labelId)));
  }

  async listLabels(
    workItemId: string,
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    const rows = await this.db
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(workItemLabels)
      .innerJoin(labels, eq(workItemLabels.labelId, labels.id))
      .where(eq(workItemLabels.workItemId, workItemId))
      .orderBy(labels.name);
    return rows;
  }
}
