/**
 * EmailRelayService — polls email_outbox and dispatches via EmailService (IEmailProvider).
 *
 * Extends AbstractOutboxRelay which owns the polling loop, concurrency guard,
 * transaction management, and retry/fail logic.  This class provides only the
 * email-specific behaviour: what to SELECT, how to send, and how to mark rows.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { InjectDrizzle, Span } from '@platform';
import type { DrizzleDB, DrizzleTx } from '@platform';
import { AbstractOutboxRelay } from '@platform/outbox';
import type { PostCommitTask } from '@platform/outbox';
import { EmailService } from '@platform/email';
import type { EmailTemplateName, EmailTemplateVars } from '@platform/email';
import { NotificationPubSubService } from '@platform/notifications';
import { NotificationPreferencesService } from '@modules/notifications';
import { emailOutbox } from '../../../../db/schema/messaging';

type EmailOutboxRow = {
  id: string;
  to: string;
  template: string;
  vars: unknown;
  attempts: number;
  idempotencyKey: string | null;
  /** Set for notification emails; null for transactional (password-reset, invitations). */
  recipientId: string | null;
  tenantId: string | null;
};

@Injectable()
export class EmailRelayService
  extends AbstractOutboxRelay<EmailOutboxRow>
  implements OnModuleInit, OnModuleDestroy
{
  private unsubscribeRelayWake?: () => Promise<void>;

  constructor(
    @InjectDrizzle() db: DrizzleDB,
    private readonly emailService: EmailService,
    private readonly pubSub: NotificationPubSubService,
    private readonly prefs: NotificationPreferencesService,
  ) {
    super(db);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Email relay started — polling email_outbox every 5s');
    this.unsubscribeRelayWake = await this.pubSub.subscribeEmailRelayWake(() => {
      this.relay().catch((err) =>
        this.logger.error({ err }, 'Email relay triggered by wake signal failed'),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribeRelayWake?.();
  }

  @Cron('*/5 * * * * *', { name: 'email-relay' })
  @Span('email.relay')
  override async relay(): Promise<void> {
    return super.relay();
  }

  // ── AbstractOutboxRelay implementation ────────────────────────────────────

  protected async fetchBatch(tx: DrizzleTx): Promise<EmailOutboxRow[]> {
    return tx
      .select({
        id: emailOutbox.id,
        to: emailOutbox.to,
        template: emailOutbox.template,
        vars: emailOutbox.vars,
        attempts: emailOutbox.attempts,
        idempotencyKey: emailOutbox.idempotencyKey,
        recipientId: emailOutbox.recipientId,
        tenantId: emailOutbox.tenantId,
      })
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.status, 'pending'),
          lt(emailOutbox.attempts, this.maxAttempts),
          lte(emailOutbox.scheduledAt, new Date()),
        ),
      )
      .orderBy(asc(emailOutbox.scheduledAt))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: EmailOutboxRow): Promise<PostCommitTask | void> {
    // If this email is linked to an internal user, check their email preference.
    // Transactional emails (password reset, invitations) have no recipientId and always send.
    if (row.recipientId && row.tenantId) {
      const emailEnabled = await this.prefs.isEmailEnabled(
        row.tenantId,
        row.recipientId,
        row.template,
      );
      if (!emailEnabled) {
        this.logger.debug(
          { recipientId: row.recipientId, template: row.template },
          'Email suppressed by preference',
        );
        return; // AbstractOutboxRelay marks the row as sent
      }
    }

    await this.emailService.sendTemplate(
      row.to,
      row.template as EmailTemplateName,
      row.vars as EmailTemplateVars[EmailTemplateName],
      // row.idempotencyKey ?? row.id is a stable key across all retries for this
      // outbox row — Resend deduplicates by this so a provider send that succeeded
      // but whose DB UPDATE failed (network blip) will NOT produce a duplicate email.
      row.idempotencyKey ?? row.id,
    );
    // No post-commit work needed — email dispatch is synchronous within processRow.
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    await tx
      .update(emailOutbox)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(emailOutbox.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
  ): Promise<void> {
    await tx
      .update(emailOutbox)
      .set({ status: newStatus, attempts: newAttempts, lastError })
      .where(eq(emailOutbox.id, rowId));
  }
}
