/**
 * NotificationSchedulerService — API-side service that enqueues in-app
 * notifications to notification_outbox within the caller's DB transaction.
 *
 * Design mirrors EmailSchedulerService:
 *   - Callers call schedule() INSIDE their business transaction.
 *   - If the transaction rolls back, the outbox row is never written → no ghost notification.
 *   - The Worker NotificationRelayService polls notification_outbox, renders
 *     the template, and writes to notifications.in_app_notifications.
 *
 * Idempotency:
 *   - idempotency_key UNIQUE + ON CONFLICT DO NOTHING prevents duplicate outbox rows
 *     even under concurrent API retries (e.g. POST /workspaces/:id/invitations retried).
 *   - The same key flows through as sourceEventId on in_app_notifications for
 *     end-to-end deduplication across relay retries.
 */
import { Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { InjectDrizzle } from '../database/drizzle.provider';
import type { DrizzleDB } from '../database/drizzle.provider';
import { NotificationPubSubService } from './notification-pubsub.service';
import { notificationOutbox } from '../../../../db/schema/messaging';
import type { NotificationTemplateName, NotificationTemplateVars } from './notification.templates';

export interface ScheduleNotificationOptions<K extends NotificationTemplateName> {
  tenantId: string;
  recipientId: string;
  /** UUID of the user whose action triggered this notification (may differ from the actor in JWT). */
  actorId?: string;
  template: K;
  vars: NotificationTemplateVars[K];
  /** UUID of the primary resource this notification links to (workspace, work item, etc.). */
  resourceId?: string;
  /** When to deliver — defaults to immediately (NOW()). */
  scheduledAt?: Date;
  /**
   * Deterministic deduplication key scoped to the business event.
   * Recommended convention:
   *   workspace-invitation → invitation.id
   *   work-item-assigned   → sha256('assigned:' + assignmentId)
   *
   * When omitted a random UUID is generated (no deduplication across retries).
   */
  idempotencyKey?: string;
}

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly pubSub: NotificationPubSubService,
  ) {}

  /**
   * Enqueues a notification to the outbox.  Must be called inside a DB
   * transaction to guarantee atomicity with the surrounding business write.
   *
   * Duplicate calls with the same idempotencyKey are silently ignored
   * (ON CONFLICT DO NOTHING).
   */
  async schedule<K extends NotificationTemplateName>(
    options: ScheduleNotificationOptions<K>,
  ): Promise<void> {
    const {
      tenantId,
      recipientId,
      actorId,
      template,
      vars,
      resourceId,
      scheduledAt,
      idempotencyKey,
    } = options;

    await this.db
      .insert(notificationOutbox)
      .values({
        id: uuidv7(),
        tenantId,
        recipientId,
        actorId,
        type: template as string,
        vars: vars as Record<string, unknown>,
        resourceId,
        scheduledAt: scheduledAt ?? new Date(),
        idempotencyKey,
      })
      .onConflictDoNothing({ target: notificationOutbox.idempotencyKey });

    this.logger.debug(
      { tenantId, recipientId, template, idempotencyKey },
      'Notification scheduled',
    );

    // Wake the Worker relay immediately so delivery latency is ~ms rather than
    // ≤5s (the cron fallback).  Published best-effort — if this fires before
    // the surrounding transaction commits the Worker will find no rows and
    // simply return; the 5s cron will catch the row after commit.
    this.pubSub.wakeRelay().catch(() => {
      /* non-critical, cron fallback handles it */
    });
  }
}
