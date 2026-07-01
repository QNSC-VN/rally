/**
 * SnapshotCronService — daily cron that materialises sprint burndown data.
 *
 * Runs at midnight UTC every day. Finds all active sprints across all tenants
 * and upserts a sprint_daily_snapshots row so burndown charts always have
 * today's data point even if no HTTP request is made.
 *
 * Design:
 * - Injects DrizzleDB directly to query cross-tenant active sprints without
 *   needing a JwtPayload actor (this is an internal scheduled operation).
 * - Aggregates work item counts using a single JOIN query per sprint.
 * - Delegates the upsert to ReportingService.upsertSnapshot() which reuses
 *   the repository SQL (no duplication).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { InjectDrizzle, ValkeyService } from '@platform';
import type { DrizzleDB } from '@platform';
import { ReportingService } from '@modules/reporting';
import { sprints, workItems, workflowStatuses } from '../../../../db/schema/work';

@Injectable()
export class SnapshotCronService {
  private readonly logger = new Logger(SnapshotCronService.name);
  /** Lock TTL: 55 min — slightly less than the 1h cron interval. */
  private readonly LOCK_TTL_MS = 55 * 60 * 1_000;

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly reportingService: ReportingService,
    private readonly valkey: ValkeyService,
  ) {}

  /** Runs at midnight UTC every day. */
  @Cron('0 0 * * *', { name: 'daily-sprint-snapshot', timeZone: 'UTC' })
  async takeDailySnapshots(): Promise<void> {
    const acquired = await this.valkey.acquireLock('cron:daily-snapshot', this.LOCK_TTL_MS);
    if (!acquired) {
      this.logger.warn('Snapshot cron lock held by another pod — skipping this tick');
      return;
    }
    try {
      await this.runSnapshots();
    } finally {
      await this.valkey.releaseLock('cron:daily-snapshot');
    }
  }

  private async runSnapshots(): Promise<void> {
    // Use the server date in UTC (cron is anchored to UTC via timeZone option)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    this.logger.log(`Taking daily sprint snapshots for ${today}`);

    const activeSprints = await this.db
      .select({ id: sprints.id, tenantId: sprints.tenantId })
      .from(sprints)
      .where(eq(sprints.status, 'active'));

    if (!activeSprints.length) {
      this.logger.debug('No active sprints — nothing to snapshot');
      return;
    }

    let snapped = 0;
    let failed = 0;

    for (const sprint of activeSprints) {
      try {
        const stats = await this.aggregateSprintStats(sprint.tenantId, sprint.id);
        await this.reportingService.upsertSnapshot({
          tenantId: sprint.tenantId,
          sprintId: sprint.id,
          snapshotDate: today,
          totalPoints: stats.totalPoints,
          completedPoints: stats.completedPoints,
          remainingPoints: stats.remainingPoints,
          totalItems: stats.totalItems,
          completedItems: stats.completedItems,
        });
        snapped++;
      } catch (err) {
        failed++;
        this.logger.error(
          { err, sprintId: sprint.id, tenantId: sprint.tenantId },
          'Failed to take sprint snapshot',
        );
      }
    }

    this.logger.log(`Daily snapshots complete — ${snapped} ok, ${failed} failed`);
  }

  private async aggregateSprintStats(
    tenantId: string,
    sprintId: string,
  ): Promise<{
    totalPoints: number;
    completedPoints: number;
    remainingPoints: number;
    totalItems: number;
    completedItems: number;
  }> {
    const result = await this.db
      .select({
        totalItems: sql<number>`count(*)::int`,
        completedItems: sql<number>`count(*) filter (where ${workflowStatuses.category} = 'done')::int`,
        totalPoints: sql<number>`coalesce(sum(${workItems.storyPoints}), 0)::int`,
        completedPoints: sql<number>`coalesce(sum(${workItems.storyPoints}) filter (where ${workflowStatuses.category} = 'done'), 0)::int`,
      })
      .from(workItems)
      .innerJoin(
        workflowStatuses,
        and(
          eq(workItems.statusId, workflowStatuses.id),
          // Ensure we join the status belonging to the same project
          eq(workflowStatuses.projectId, workItems.projectId),
        ),
      )
      .where(
        and(
          eq(workItems.tenantId, tenantId),
          eq(workItems.iterationId, sprintId),
          isNull(workItems.deletedAt),
        ),
      );

    const row = result[0];
    const totalPoints = row?.totalPoints ?? 0;
    const completedPoints = row?.completedPoints ?? 0;

    return {
      totalPoints,
      completedPoints,
      remainingPoints: totalPoints - completedPoints,
      totalItems: row?.totalItems ?? 0,
      completedItems: row?.completedItems ?? 0,
    };
  }
}
