import { Injectable } from '@nestjs/common';
import { and, desc, eq, count } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { activityLogs } from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import type { ActivityLog, CreateActivityLogInput } from '../../domain/activity-log.types';
import { IActivityLogRepository } from '../../domain/ports/activity-log.repository';

@Injectable()
export class ActivityLogDrizzleRepository implements IActivityLogRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async append(input: CreateActivityLogInput, executor?: DbExecutor): Promise<void> {
    await this.appendMany([input], executor);
  }

  async appendMany(inputs: CreateActivityLogInput[], executor?: DbExecutor): Promise<void> {
    if (inputs.length === 0) return;
    const exec = executor ?? this.db;
    await exec.insert(activityLogs).values(
      inputs.map((input) => ({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        entityType: input.entityType,
        entityId: input.entityId,
        actorId: input.actorId,
        action: input.action,
        changes: input.changes ?? null,
        metadata: input.metadata ?? {},
      })),
    );
  }

  async listByWorkItem(
    workItemId: string,
    tenantId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    const where = and(eq(activityLogs.workItemId, workItemId), eq(activityLogs.tenantId, tenantId));

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: activityLogs.id,
          tenantId: activityLogs.tenantId,
          projectId: activityLogs.projectId,
          workItemId: activityLogs.workItemId,
          entityType: activityLogs.entityType,
          entityId: activityLogs.entityId,
          actorId: activityLogs.actorId,
          actorName: users.displayName,
          action: activityLogs.action,
          changes: activityLogs.changes,
          metadata: activityLogs.metadata,
          createdAt: activityLogs.createdAt,
        })
        .from(activityLogs)
        .leftJoin(users, eq(activityLogs.actorId, users.id))
        .where(where)
        .orderBy(desc(activityLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(activityLogs).where(where),
    ]);

    return {
      items: rows as ActivityLog[],
      total: Number(totalRows[0]?.value ?? 0),
    };
  }
}
