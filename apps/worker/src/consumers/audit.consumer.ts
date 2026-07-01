/**
 * AuditConsumer — SQS long-poll consumer that receives domain events from
 * the audit queue and persists them as audit log entries.
 *
 * Every domain event published through the outbox → SNS → SQS audit queue
 * lands here. The consumer maps the event fields directly onto AuditService
 * without requiring any extra context lookups.
 *
 * Message format (raw SNS message delivery):
 * {
 *   "eventId": "<uuid>",
 *   "eventType": "WORK_ITEM_CREATED",
 *   "aggregateType": "WORK_ITEM",
 *   "aggregateId": "<uuid>",
 *   "tenantId": "<uuid>",
 *   "payload": {
 *     "actorId": "<uuid>",
 *     "actorEmail": "user@example.com",
 *     "projectId": "<uuid>",
 *     "changes": { "before": {}, "after": {} }
 *   },
 *   "occurredAt": "2026-06-20T..."
 * }
 *
 * The consumer is disabled (gracefully) when SQS_AUDIT_URL is not set.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { AppConfigService } from '@platform';
import { AuditService } from '@modules/audit';

interface DomainEventMessage {
  /** Outbox row UUID — used as deduplication key (sourceEventId). */
  eventId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

@Injectable()
export class AuditConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditConsumer.name);
  private sqs!: SQSClient;
  private queueUrl: string | undefined;
  private isShuttingDown = false;
  /** Cancels in-flight SQS long-poll and sleep on shutdown. */
  private readonly abortController = new AbortController();

  constructor(
    private readonly config: AppConfigService,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit(): void {
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    this.sqs = new SQSClient({
      region: this.config.get('AWS_REGION'),
      ...(endpoint ? { endpoint } : {}),
    });

    this.queueUrl = this.config.get('SQS_AUDIT_URL') ?? undefined;

    if (!this.queueUrl) {
      this.logger.warn('SQS_AUDIT_URL not set — audit consumer disabled');
      return;
    }

    this.logger.log(`Audit consumer polling ${this.queueUrl}`);
    this.startPolling().catch((err) =>
      this.logger.error({ err }, 'Audit consumer polling loop crashed'),
    );
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    this.abortController.abort();
    this.sqs.destroy();
  }

  private async startPolling(): Promise<void> {
    while (!this.isShuttingDown) {
      await this.poll();
    }
    this.logger.log('Audit consumer stopped');
  }

  private async poll(): Promise<void> {
    try {
      const response = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl!,
          MaxNumberOfMessages: 10,
          // Long-polling: blocks up to 20s waiting for messages.
          // The loop re-enters immediately after, so effective poll rate is fast
          // when messages are flowing and slow when idle.
          WaitTimeSeconds: 20,
          VisibilityTimeout: 60,
        }),
        { abortSignal: this.abortController.signal },
      );

      for (const msg of response.Messages ?? []) {
        await this.handleMessage(msg.Body ?? '', msg.ReceiptHandle ?? '');
      }
    } catch (err) {
      if (!this.isShuttingDown) {
        this.logger.error({ err }, 'SQS receive error — backing off 5s');
        await this.sleep(5_000);
      }
    }
  }

  private async handleMessage(body: string, receiptHandle: string): Promise<void> {
    let event: DomainEventMessage;

    try {
      event = JSON.parse(body) as DomainEventMessage;
    } catch {
      this.logger.warn({ body }, 'Unparseable audit message — discarding');
      await this.deleteMessage(receiptHandle);
      return;
    }

    try {
      await this.auditService.record({
        tenantId: event.tenantId,
        action: event.eventType,
        resourceType: event.aggregateType,
        resourceId: event.aggregateId,
        actorId: (event.payload['actorId'] as string | undefined) ?? undefined,
        actorEmail: (event.payload['actorEmail'] as string | undefined) ?? undefined,
        projectId: (event.payload['projectId'] as string | undefined) ?? undefined,
        changes:
          (event.payload['changes'] as { before?: unknown; after?: unknown } | undefined) ??
          undefined,
        metadata: { source: 'domain-event', occurredAt: event.occurredAt },
        // Deduplication: if the same outbox event is delivered twice,
        // the unique index on source_event_id silently skips the second insert.
        sourceEventId: event.eventId,
      });
      await this.deleteMessage(receiptHandle);
    } catch (err) {
      // Don't delete — SQS visibility timeout expires and message is redelivered
      this.logger.error(
        { err, eventType: event.eventType },
        'Failed to record audit log — message will be retried',
      );
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl!,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.abortController.signal.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      this.abortController.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
