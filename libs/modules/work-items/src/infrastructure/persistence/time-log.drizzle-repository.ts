import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { timeLogs } from '../../../../../../db/schema/work';
import type { TimeLog, CreateTimeLogInput, UpdateTimeLogInput } from '../../domain/time-log.types';
import type { ITimeLogRepository } from '../../domain/ports/time-log.repository';

@Injectable()
export class TimeLogDrizzleRepository implements ITimeLogRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string, tenantId: string): Promise<TimeLog | null> {
    const rows = await this.db
      .select()
      .from(timeLogs)
      .where(and(eq(timeLogs.id, id), eq(timeLogs.tenantId, tenantId), isNull(timeLogs.deletedAt)))
      .limit(1);
    return (rows[0] as TimeLog | undefined) ?? null;
  }

  async listByWorkItem(
    workItemId: string,
    tenantId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<{ items: TimeLog[]; total: number }> {
    const condition = and(
      eq(timeLogs.workItemId, workItemId),
      eq(timeLogs.tenantId, tenantId),
      isNull(timeLogs.deletedAt),
    );

    const [rows, [{ cnt }]] = await Promise.all([
      this.db
        .select()
        .from(timeLogs)
        .where(condition)
        .orderBy(desc(timeLogs.loggedDate), desc(timeLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ cnt: count() }).from(timeLogs).where(condition),
    ]);

    return { items: rows as TimeLog[], total: Number(cnt) };
  }

  async create(input: CreateTimeLogInput): Promise<TimeLog> {
    const rows = await this.db
      .insert(timeLogs)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        userId: input.userId,
        loggedDate: input.loggedDate,
        hours: input.hours,
        description: input.description ?? null,
      })
      .returning();
    return rows[0] as TimeLog;
  }

  async update(id: string, input: UpdateTimeLogInput): Promise<TimeLog> {
    const rows = await this.db
      .update(timeLogs)
      .set({
        ...(input.hours !== undefined && { hours: input.hours }),
        ...(input.loggedDate !== undefined && { loggedDate: input.loggedDate }),
        ...(input.description !== undefined && { description: input.description }),
        updatedAt: new Date(),
      })
      .where(eq(timeLogs.id, id))
      .returning();
    return rows[0] as TimeLog;
  }

  async softDelete(id: string): Promise<TimeLog> {
    const rows = await this.db
      .update(timeLogs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(timeLogs.id, id))
      .returning();
    return rows[0] as TimeLog;
  }
}
