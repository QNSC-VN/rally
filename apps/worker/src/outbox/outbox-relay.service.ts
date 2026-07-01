/**
 * OutboxRelayService — polls outbox_events for pending domain events and
 * publishes them to SNS.
 *
 * Extends AbstractOutboxRelay which owns the polling loop, concurrency guard,
 * transaction management, and retry/fail logic.  This class provides only the
 * SNS-specific behaviour: what to SELECT, how to publish, and how to mark rows.
 *
 * Uses SELECT ... FOR UPDATE SKIP LOCKED inside a transaction so multiple
 * worker instances never process the same batch concurrently (safe horizontal
 * scaling). If SNS_TOPIC_ARN is not configured the event is acked without
 * publishing — useful in local dev without LocalStack.
 *
 * Delivery guarantee: at-least-once. Consumers must be idempotent on eventId.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { and, asc, lt, eq } from 'drizzle-orm';
import { InjectDrizzle, AppConfigService, ResilienceService, ResiliencePreset, Span } from '@platform';
import type { DrizzleDB, DrizzleTx } from '@platform';
import { AbstractOutboxRelay } from '@platform/outbox';
import { outboxEvents } from '../../../../db/schema/messaging';

type OutboxEventRow = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
};

@Injectable()
export class OutboxRelayService
  extends AbstractOutboxRelay<OutboxEventRow>
  implements OnModuleInit, OnModuleDestroy
{
  private sns!: SNSClient;
  private topicArn: string | undefined;

  constructor(
    @InjectDrizzle() db: DrizzleDB,
    private readonly config: AppConfigService,
    private readonly resilience: ResilienceService,
  ) {
    super(db);
  }

  onModuleInit(): void {
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    this.sns = new SNSClient({
      region: this.config.get('AWS_REGION'),
      ...(endpoint ? { endpoint } : {}),
    });

    this.topicArn = this.config.get('SNS_TOPIC_ARN') ?? undefined;

    if (!this.topicArn) {
      this.logger.warn(
        'SNS_TOPIC_ARN not set — outbox events will be acked without publishing (dev mode)',
      );
    } else {
      this.logger.log(`Outbox relay → SNS topic ${this.topicArn}`);
    }
  }

  onModuleDestroy(): void {
    this.sns.destroy();
  }

  /** Runs every 5 seconds. */
  @Cron('*/5 * * * * *', { name: 'outbox-relay' })
  @Span('outbox.relay')
  override async relay(): Promise<void> {
    return super.relay();
  }

  // ── AbstractOutboxRelay implementation ────────────────────────────────────

  protected async fetchBatch(tx: DrizzleTx): Promise<OutboxEventRow[]> {
    return tx
      .select({
        id: outboxEvents.id,
        eventType: outboxEvents.eventType,
        aggregateType: outboxEvents.aggregateType,
        aggregateId: outboxEvents.aggregateId,
        tenantId: outboxEvents.tenantId,
        payload: outboxEvents.payload,
        occurredAt: outboxEvents.occurredAt,
        attempts: outboxEvents.attempts,
      })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, 'pending'), lt(outboxEvents.attempts, this.maxAttempts)))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: OutboxEventRow): Promise<void> {
    // No SNS topic configured (local dev) — ack without publishing.
    if (!this.topicArn) return;

    await this.resilience.execute(
      'sns.publishOutboxEvent',
      () => this.sns.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify({
            // eventId is the deduplication key for downstream consumers.
            // Including it allows idempotent processing via ON CONFLICT DO NOTHING.
            eventId: row.id,
            eventType: row.eventType,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            tenantId: row.tenantId,
            payload: row.payload,
            occurredAt: row.occurredAt,
          }),
          MessageAttributes: {
            eventType: {
              DataType: 'String',
              StringValue: row.eventType,
            },
            aggregateType: {
              DataType: 'String',
              StringValue: row.aggregateType,
            },
            tenantId: {
              DataType: 'String',
              StringValue: row.tenantId,
            },
          },
        }),
      ),
      ResiliencePreset.EXTERNAL_API,
    );
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    await tx
      .update(outboxEvents)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(outboxEvents.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
  ): Promise<void> {
    await tx
      .update(outboxEvents)
      .set({ status: newStatus, attempts: newAttempts, lastError })
      .where(eq(outboxEvents.id, rowId));
  }
}
