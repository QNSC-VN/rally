import { Injectable } from '@nestjs/common';
import { and, desc, eq, count } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { iterationActivityLogs } from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import type {
  IterationActivityLog,
  CreateIterationActivityLogInput,
} from '../../domain/activity-log.types';
import { IIterationActivityLogRepository } from '../../domain/ports/iteration-activity-log.repository';

@Injectable()
export class IterationActivityLogDrizzleRepository implements IIterationActivityLogRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async append(input: CreateIterationActivityLogInput): Promise<void> {
    await this.appendMany([input]);
  }

  async appendMany(inputs: CreateIterationActivityLogInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await this.db.insert(iterationActivityLogs).values(
      inputs.map((input) => ({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        iterationId: input.iterationId,
        actorId: input.actorId,
        action: input.action,
        changes: input.changes ?? null,
        metadata: input.metadata ?? {},
      })),
    );
  }

  async listByIteration(
    iterationId: string,
    workspaceId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<{ items: IterationActivityLog[]; total: number }> {
    const where = and(
      eq(iterationActivityLogs.iterationId, iterationId),
      eq(iterationActivityLogs.workspaceId, workspaceId),
    );

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: iterationActivityLogs.id,
          workspaceId: iterationActivityLogs.workspaceId,
          projectId: iterationActivityLogs.projectId,
          iterationId: iterationActivityLogs.iterationId,
          actorId: iterationActivityLogs.actorId,
          actorName: users.displayName,
          action: iterationActivityLogs.action,
          changes: iterationActivityLogs.changes,
          metadata: iterationActivityLogs.metadata,
          createdAt: iterationActivityLogs.createdAt,
        })
        .from(iterationActivityLogs)
        .leftJoin(users, eq(iterationActivityLogs.actorId, users.id))
        .where(where)
        .orderBy(desc(iterationActivityLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(iterationActivityLogs).where(where),
    ]);

    return {
      items: rows as IterationActivityLog[],
      total: Number(totalRows[0]?.value ?? 0),
    };
  }
}
