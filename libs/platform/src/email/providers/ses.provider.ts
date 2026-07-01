/**
 * SesEmailProvider — production AWS SES transport.
 *
 * Requires:
 *   MAIL_FROM_EMAIL (or SES_FROM_EMAIL) — verified sender address
 *   MAIL_FROM_NAME                       — display name, e.g. "Mini Rally"
 *   AWS_REGION                           — e.g. us-east-1
 *   IAM role / env creds with ses:SendEmail
 *
 * Anti-spam / Google-Yahoo 2024 compliance:
 *   - Proper "Display Name <address>" From header → avoids spam filters.
 *   - HTML + plain-text always paired → higher deliverability score.
 *   - SPF/DKIM/DMARC: configure in SES domain verification wizard (DNS-level).
 *   - SES auto-generates a unique Message-ID per send.
 *   - List-Unsubscribe for marketing emails: upgrade to @aws-sdk/client-sesv2
 *     SendEmailCommand which supports Headers, or use SendRawEmailCommand.
 *     Not needed for Phase 0 (only transactional emails in use).
 */
import { Injectable, Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { AppConfigService } from '../../config/app-config.service';
import type { IEmailProvider, EmailPayload } from '../email.provider';
import { buildFromAddress } from './shared';

@Injectable()
export class SesEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(SesEmailProvider.name);
  private readonly ses: SESClient;
  private readonly fromAddress: string;
  private readonly replyTo: string | undefined;

  constructor(private readonly config: AppConfigService) {
    this.fromAddress = buildFromAddress(config);
    this.replyTo = config.get('MAIL_REPLY_TO') as string | undefined;

    const endpoint = process.env['AWS_ENDPOINT_URL'];
    this.ses = new SESClient({
      region: config.get('AWS_REGION'),
      ...(endpoint ? { endpoint } : {}),
    });
  }

  async send(payload: EmailPayload): Promise<void> {
    const category = payload.category ?? 'transactional';
    const replyToAddresses = payload.replyTo
      ? [payload.replyTo]
      : this.replyTo
        ? [this.replyTo]
        : [];

    try {
      await this.ses.send(
        new SendEmailCommand({
          Source: payload.from ?? this.fromAddress,
          ...(replyToAddresses.length > 0 ? { ReplyToAddresses: replyToAddresses } : {}),
          Destination: { ToAddresses: [payload.to] },
          Message: {
            Subject: { Data: payload.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: payload.html, Charset: 'UTF-8' },
              Text: { Data: payload.text, Charset: 'UTF-8' },
            },
          },
        }),
      );
      this.logger.log({ to: payload.to, subject: payload.subject, category }, 'Email sent via SES');
    } catch (err) {
      this.logger.error({ err, to: payload.to, subject: payload.subject }, 'SES send failed');
      throw err;
    }
  }
}
