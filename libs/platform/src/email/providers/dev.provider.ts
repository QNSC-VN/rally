/**
 * DevEmailProvider — dev/test transport that logs email payloads to stdout.
 *
 * Active when EMAIL_PROVIDER=dev (the default).
 * Lets the entire flow (template render, scheduler, relay) run without a
 * real email provider — the rendered subject/text is fully visible in logs.
 * Set EMAIL_PROVIDER=ses or EMAIL_PROVIDER=resend to use a real provider.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { IEmailProvider, EmailPayload } from '../email.provider';
import { AppConfigService } from '../../config';

@Injectable()
export class DevEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(DevEmailProvider.name);

  constructor(private readonly config: AppConfigService) {}

  async send(payload: EmailPayload): Promise<void> {
    const fields: Record<string, unknown> = {
      to: payload.to,
      from: payload.from,
      subject: payload.subject,
      category: payload.category ?? 'transactional',
      idempotencyKey: payload.idempotencyKey,
    };

    if (this.config.get('LOG_DEV_EMAIL_CONTENT')) {
      fields['text'] = payload.text;
    }

    this.logger.debug(
      fields,
      '[DEV EMAIL] Would send email — set EMAIL_PROVIDER=ses|resend to use a real transport',
    );
  }
}
