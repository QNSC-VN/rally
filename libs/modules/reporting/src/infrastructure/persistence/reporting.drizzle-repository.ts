import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { iterationDailySnapshots, iterations } from '../../../../../../db/schema/work';
import type { SprintSnapshot, VelocityPoint } from '../../domain/reporting.types';
import { IReportingRepository } from '../../domain/ports/reporting.repository';
import { uuidv7 } from 'uuidv7';

@Injectable()
export class ReportingDrizzleRepository implements IReportingRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async getSprintSnapshots(tenantId: string, sprintId: string): Promise<SprintSnapshot[]> {
    const rows = await this.db
      .select()
      .from(iterationDailySnapshots)
      .where(
        and(
          eq(iterationDailySnapshots.tenantId, tenantId),
          eq(iterationDailySnapshots.iterationId, sprintId),
        ),
      )
      .orderBy(asc(iterationDailySnapshots.snapshotDate));
    // Reporting domain still speaks "sprintId" (Phase 5 rename); map the renamed
    // physical column back onto the domain field.
    return rows.map((r) => {
      const { iterationId, ...rest } = r;
      return { ...rest, sprintId: iterationId } as SprintSnapshot;
    });
  }

  async getVelocity(
    tenantId: string,
    projectId: string,
    lastNSprints: number,
  ): Promise<VelocityPoint[]> {
    // Get last N accepted iterations for the project (Rally: accepted = completed).
    const completedSprints = await this.db
      .select()
      .from(iterations)
      .where(
        and(
          eq(iterations.tenantId, tenantId),
          eq(iterations.projectId, projectId),
          eq(iterations.state, 'accepted'),
        ),
      )
      .orderBy(desc(iterations.completedAt))
      .limit(lastNSprints);

    if (!completedSprints.length) return [];

    // Fetch the final snapshot for every iteration in ONE query (DISTINCT ON keeps
    // the newest row per iteration), instead of N round trips — one per iteration.
    const sprintIds = completedSprints.map((s) => s.id);
    const latestSnapshots = await this.db
      .selectDistinctOn([iterationDailySnapshots.iterationId], {
        sprintId: iterationDailySnapshots.iterationId,
        completedPoints: iterationDailySnapshots.completedPoints,
        completedItems: iterationDailySnapshots.completedItems,
      })
      .from(iterationDailySnapshots)
      .where(
        and(
          eq(iterationDailySnapshots.tenantId, tenantId),
          inArray(iterationDailySnapshots.iterationId, sprintIds),
        ),
      )
      .orderBy(iterationDailySnapshots.iterationId, desc(iterationDailySnapshots.snapshotDate));

    const snapshotBySprintId = new Map(latestSnapshots.map((s) => [s.sprintId, s]));

    // completedSprints is ordered newest-first; reverse for chronological output.
    return completedSprints
      .map((sprint) => {
        const last = snapshotBySprintId.get(sprint.id);
        return {
          sprintId: sprint.id,
          sprintName: sprint.name,
          completedPoints: last?.completedPoints ?? 0,
          completedItems: last?.completedItems ?? 0,
        };
      })
      .reverse();
  }

  async upsertSnapshot(snapshot: Omit<SprintSnapshot, 'id' | 'createdAt'>): Promise<void> {
    await this.db
      .insert(iterationDailySnapshots)
      .values({
        id: uuidv7(),
        tenantId: snapshot.tenantId,
        iterationId: snapshot.sprintId,
        snapshotDate: snapshot.snapshotDate,
        totalPoints: snapshot.totalPoints,
        completedPoints: snapshot.completedPoints,
        remainingPoints: snapshot.remainingPoints,
        totalItems: snapshot.totalItems,
        completedItems: snapshot.completedItems,
      })
      .onConflictDoUpdate({
        target: [iterationDailySnapshots.iterationId, iterationDailySnapshots.snapshotDate],
        set: {
          totalPoints: sql`excluded.total_points`,
          completedPoints: sql`excluded.completed_points`,
          remainingPoints: sql`excluded.remaining_points`,
          totalItems: sql`excluded.total_items`,
          completedItems: sql`excluded.completed_items`,
        },
      });
  }
}
