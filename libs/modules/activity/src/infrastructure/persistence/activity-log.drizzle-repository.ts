import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, or } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { activityLogs } from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import type {
  ActivityLog,
  ActivityPage,
  CreateActivityInput,
} from '../../domain/activity-log.types';
import { IActivityLogRepository } from '../../domain/ports/activity-log.repository';

@Injectable()
export class ActivityLogDrizzleRepository implements IActivityLogRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async appendMany(inputs: CreateActivityInput[], executor?: DbExecutor): Promise<void> {
    if (inputs.length === 0) return;
    const exec = executor ?? this.db;
    await exec.insert(activityLogs).values(
      inputs.map((input) => ({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        contextId: input.contextId ?? null,
        actorId: input.actorId,
        action: input.action,
        changes: input.changes ?? null,
        metadata: input.metadata ?? {},
      })),
    );
  }

  async listFor(
    entityId: string,
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<ActivityPage> {
    const offset = (page - 1) * pageSize;
    // Entity's own logs + any child logs anchored to it (context_id), scoped to
    // the caller's workspace. The workspace predicate is not redundant with the
    // callers' pre-load checks: entity ids are globally unique and arrive from
    // the request, so without it a borrowed id resolves to another workspace's
    // history the moment a caller forgets to pre-load the parent.
    const where = and(
      eq(activityLogs.workspaceId, workspaceId),
      or(eq(activityLogs.entityId, entityId), eq(activityLogs.contextId, entityId)),
    );

    const rows = await this.db
      .select({
        id: activityLogs.id,
        createdAt: activityLogs.createdAt,
        actorId: activityLogs.actorId,
        actorName: users.displayName,
        entityType: activityLogs.entityType,
        entityId: activityLogs.entityId,
        action: activityLogs.action,
        changes: activityLogs.changes,
        metadata: activityLogs.metadata,
      })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorId))
      .where(where)
      .orderBy(desc(activityLogs.createdAt), asc(activityLogs.id))
      .limit(pageSize)
      .offset(offset);

    const [totalRow] = await this.db.select({ total: count() }).from(activityLogs).where(where);

    return {
      data: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorId: r.actorId,
        actorName: r.actorName ?? null,
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        changes: r.changes as ActivityLog['changes'],
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      })),
      total: Number(totalRow?.total ?? 0),
      page,
      pageSize,
    };
  }
}
