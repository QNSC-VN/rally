/**
 * ResendEmailProvider — production transport via Resend (resend.com).
 *
 * Why Resend for Phase 0:
 *   - Single env var setup (RESEND_API_KEY) vs complex AWS IAM.
 *   - Automatic DKIM signing per domain (configure in Resend dashboard).
 *   - SPF record auto-provided after domain verification.
 *   - Generous free tier (100 emails/day) → $20/mo for 50 000/mo.
 *   - Native idempotency key support — safe to retry on network failure.
 *   - Built-in bounce/complaint webhooks → maintain spam rate < 0.1 %.
 *
 * Requires:
 *   RESEND_API_KEY   — from https://resend.com/api-keys
 *   MAIL_FROM_EMAIL  — verified sender address (must match verified domain)
 *   MAIL_FROM_NAME   — display name, e.g. "Mini Rally"
 *
 * Anti-spam / Google-Yahoo 2024 compliance:
 *   - Proper "Display Name <address>" From header.
 *   - category='transactional': no List-Unsubscribe.
 *   - category='notification'|'marketing': RFC 2369 + RFC 8058 headers.
 *   - DKIM/SPF handled by Resend's infrastructure per your verified domain.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import type { IEmailProvider, EmailPayload } from '../email.provider';
import { buildFromAddress, resolveFromEmail, buildUnsubscribeHeaders } from './shared';

@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend;
  private readonly fromAddress: string;
  private readonly replyTo: string | undefined;
  private readonly appBaseUrl: string;

  constructor(private readonly config: AppConfigService) {
    const apiKey = config.get('RESEND_API_KEY') as string;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY must be set when EMAIL_PROVIDER=resend');
    }
    this.client = new Resend(apiKey);

    const fromEmail = resolveFromEmail(config);
    if (!fromEmail) {
      throw new Error('MAIL_FROM_EMAIL must be set when EMAIL_PROVIDER=resend');
    }
    this.fromAddress = buildFromAddress(config);
    this.replyTo = config.get('MAIL_REPLY_TO') as string | undefined;
    this.appBaseUrl = config.get('APP_BASE_URL') as string;
  }

  async send(payload: EmailPayload): Promise<void> {
    const category = payload.category ?? 'transactional';
    const idempotencyKey = payload.idempotencyKey ?? randomUUID();

    const headers: Record<string, string> = {
      'X-Entity-Ref-ID': idempotencyKey,
      ...buildUnsubscribeHeaders(category, this.appBaseUrl),
    };

    try {
      const { error } = await this.client.emails.send(
        {
          from: payload.from ?? this.fromAddress,
          to: payload.to,
          replyTo: payload.replyTo ?? this.replyTo,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          headers,
          tags: [{ name: 'category', value: category }],
        },
        // Idempotency key passed as second-arg options (Resend SDK v4+).
        { idempotencyKey: idempotencyKey },
      );

      if (error) {
        throw new Error(`Resend error: ${error.message}`);
      }

      this.logger.log(
        { to: payload.to, subject: payload.subject, category, idempotencyKey },
        'Email sent via Resend',
      );
    } catch (err) {
      this.logger.error({ err, to: payload.to, subject: payload.subject }, 'Resend send failed');
      throw err;
    }
  }
}
