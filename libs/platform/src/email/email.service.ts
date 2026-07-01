/**
 * EmailService — worker-side render-and-dispatch service.
 *
 * Called exclusively by EmailRelayService (worker).
 * Renders the named template and dispatches to IEmailProvider.
 *
 * API-side code: use EmailSchedulerService.schedule() instead.
 *
 * Resilience strategy (two complementary layers):
 *   - ResiliencePreset.EMAIL (here): in-process, fine-grained.
 *     Retry with jitter (≤5 attempts, ms-to-seconds gaps) + circuit-breaker
 *     (opens after 3 failures, half-open after 2 min) + 30s timeout + bulkhead
 *     (≤5 concurrent sends).  Protects against transient provider blips.
 *   - EmailRelayService MAX_ATTEMPTS (coarse-grained, DB-level):
 *     Retries across cron ticks (5s gap), handles provider outages lasting
 *     minutes.  The two layers are complementary — ResilienceService fires
 *     first; if it exhausts its retries the relay marks the attempt and tries
 *     again on the next tick.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EMAIL_PROVIDER } from './email.provider';
import type { IEmailProvider } from './email.provider';
import { renderEmailTemplate } from './templates';
import type { EmailTemplateName, EmailTemplateVars } from './templates';
import { ResilienceService, ResiliencePreset } from '../resilience';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    private readonly resilience: ResilienceService,
  ) {}

  /**
   * Render `template` with `vars` and send via the registered IEmailProvider.
   *
   * The provider call is wrapped with ResiliencePreset.EMAIL:
   *   - Retry × 5 with exponential backoff + jitter (ms-level gaps).
   *   - Circuit breaker: opens after 3 consecutive failures, half-open at 2 min.
   *   - Timeout: 30 s hard cap per provider call.
   *   - Bulkhead: ≤ 5 concurrent sends (protects the worker's event loop).
   *
   * Throws after all retries fail so the relay can increment attempts and
   * retry on the next outbox tick (coarse-grained, minutes-level recovery).
   */
  async sendTemplate<K extends EmailTemplateName>(
    to: string,
    template: K,
    vars: EmailTemplateVars[K],
    idempotencyKey?: string,
  ): Promise<void> {
    const rendered = renderEmailTemplate(template, vars);
    const key = idempotencyKey ?? randomUUID();
    this.logger.log(
      { to, template, subject: rendered.subject, category: rendered.category },
      'Dispatching email',
    );
    await this.resilience.execute(
      'email.provider.send',
      () =>
        this.provider.send({
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          category: rendered.category,
          idempotencyKey: key,
        }),
      ResiliencePreset.EMAIL,
    );
  }
}
