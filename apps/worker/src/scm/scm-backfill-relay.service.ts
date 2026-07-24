/**
 * ScmBackfillRelayService — drains scm.backfill_jobs and pulls each repo's
 * existing PRs/commits via the GitHub App REST API (ScmBackfillService), linking
 * the ones that reference work-item keys through the SAME idempotent path as the
 * webhook relay. Re-running (or overlapping with a live webhook) never dups.
 *
 * Extends AbstractOutboxRelay (owns polling, FOR UPDATE SKIP LOCKED, retry/
 * backoff). Backfill hits the network + rate limits, so it runs on a slower 30s
 * cron with a small batch (one repo at a time) — history is not latency-critical.
 * Counts from a run are stashed per-row so markSent can persist them.
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { InjectDrizzle, Span } from '@platform';
import type { DrizzleDB, DrizzleTx } from '@platform';
import { AbstractOutboxRelay } from '@platform/outbox';
import { ScmBackfillService } from '@modules/scm';
import type { BackfillCounts } from '@modules/scm';
import { scmBackfillJobs } from '../../../../db/schema/scm';

type BackfillJobRow = {
  id: string;
  attempts: number;
  repositoryId: string;
};

@Injectable()
export class ScmBackfillRelayService extends AbstractOutboxRelay<BackfillJobRow> {
  protected override readonly batchSize = 1;
  /** Counts produced by the current pass, keyed by job id (consumed in markSent). */
  private readonly counts = new Map<string, BackfillCounts>();

  constructor(
    @InjectDrizzle() db: DrizzleDB,
    private readonly backfill: ScmBackfillService,
  ) {
    super(db);
  }

  @Cron('*/30 * * * * *', { name: 'scm-backfill-relay' })
  @Span('scm.backfill.relay')
  override async relay(): Promise<void> {
    return super.relay();
  }

  protected async fetchBatch(tx: DrizzleTx): Promise<BackfillJobRow[]> {
    return tx
      .select({
        id: scmBackfillJobs.id,
        attempts: scmBackfillJobs.attempts,
        repositoryId: scmBackfillJobs.repositoryId,
      })
      .from(scmBackfillJobs)
      .where(
        and(
          eq(scmBackfillJobs.status, 'pending'),
          lt(scmBackfillJobs.attempts, this.maxAttempts),
          lte(scmBackfillJobs.scheduledAt, new Date()),
        ),
      )
      .orderBy(asc(scmBackfillJobs.scheduledAt))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: BackfillJobRow): Promise<void> {
    this.counts.set(row.id, await this.backfill.run(row.repositoryId));
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    const counts = this.counts.get(rowId) ?? null;
    this.counts.delete(rowId);
    await tx
      .update(scmBackfillJobs)
      .set({ status: 'done', counts, finishedAt: new Date() })
      .where(eq(scmBackfillJobs.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    this.counts.delete(rowId);
    await tx
      .update(scmBackfillJobs)
      .set({
        status: newStatus,
        attempts: newAttempts,
        lastError,
        ...(newStatus === 'failed' ? { finishedAt: new Date() } : {}),
        ...(newStatus === 'pending' ? { scheduledAt: nextAttemptAt } : {}),
      })
      .where(eq(scmBackfillJobs.id, rowId));
  }
}
