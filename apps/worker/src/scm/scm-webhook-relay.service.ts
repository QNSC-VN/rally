/**
 * ScmWebhookRelayService — drains scm.webhook_inbox and links PRs/commits to
 * work items via ScmLinkerService.
 *
 * Extends AbstractOutboxRelay (owns the polling loop, FOR UPDATE SKIP LOCKED
 * transaction, concurrency guard, and retry/backoff). This class provides only
 * the SCM-specific behaviour: what to SELECT, how to process a row, and how to
 * mark it. Linking is idempotent (unique constraints), so retries/redelivery
 * never duplicate. The 5s cron is the delivery mechanism (no wake signal —
 * SCM connections are not latency-critical).
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { InjectDrizzle, Span } from '@platform';
import type { DrizzleDB, DrizzleTx } from '@platform';
import { AbstractOutboxRelay } from '@platform/outbox';
import { ScmLinkerService } from '@modules/scm';
import type { ScmProvider } from '@modules/scm';
import { scmWebhookInbox } from '../../../../db/schema/scm';

type ScmInboxRow = {
  id: string;
  attempts: number;
  provider: string;
  eventType: string;
  payload: unknown;
};

@Injectable()
export class ScmWebhookRelayService extends AbstractOutboxRelay<ScmInboxRow> {
  constructor(
    @InjectDrizzle() db: DrizzleDB,
    private readonly linker: ScmLinkerService,
  ) {
    super(db);
  }

  @Cron('*/5 * * * * *', { name: 'scm-webhook-relay' })
  @Span('scm.webhook.relay')
  override async relay(): Promise<void> {
    return super.relay();
  }

  protected async fetchBatch(tx: DrizzleTx): Promise<ScmInboxRow[]> {
    return tx
      .select({
        id: scmWebhookInbox.id,
        attempts: scmWebhookInbox.attempts,
        provider: scmWebhookInbox.provider,
        eventType: scmWebhookInbox.eventType,
        payload: scmWebhookInbox.payload,
      })
      .from(scmWebhookInbox)
      .where(
        and(
          eq(scmWebhookInbox.status, 'pending'),
          lt(scmWebhookInbox.attempts, this.maxAttempts),
          lte(scmWebhookInbox.scheduledAt, new Date()),
        ),
      )
      .orderBy(asc(scmWebhookInbox.scheduledAt))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: ScmInboxRow): Promise<void> {
    // Both 'processed' and 'ignored' (unmapped repo / no keys) mean "handled";
    // markSent records completion. Idempotent upserts inside the linker make a
    // retry after a mid-batch failure a safe no-op.
    await this.linker.linkEvent(row.provider as ScmProvider, row.eventType, row.payload);
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    await tx
      .update(scmWebhookInbox)
      .set({ status: 'processed', processedAt: new Date() })
      .where(eq(scmWebhookInbox.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await tx
      .update(scmWebhookInbox)
      .set({
        status: newStatus,
        attempts: newAttempts,
        lastError,
        ...(newStatus === 'pending' ? { scheduledAt: nextAttemptAt } : {}),
      })
      .where(eq(scmWebhookInbox.id, rowId));
  }
}
