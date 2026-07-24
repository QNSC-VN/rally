import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { Public, AppConfigService } from '@platform';
import { ScmService } from '../../application/scm.service';
import type { ScmProvider } from '../../domain/scm.types';

const HANDLED_EVENTS = new Set(['pull_request', 'push']);
const PROVIDERS = new Set<ScmProvider>(['github', 'ghe']);

/**
 * GitHub / GHE webhook receiver. @Public (no JWT); authenticity is proven by the
 * HMAC over the RAW body vs X-Hub-Signature-256. Verified events are persisted to
 * scm.webhook_inbox (deduped on X-GitHub-Delivery) and processed asynchronously
 * by the worker relay — so this returns 202 fast and never blocks on linking.
 *
 * Requires Fastify raw-body (enabled in main.ts via NestFactory { rawBody: true }).
 */
@ApiExcludeController()
@Controller('scm')
export class ScmWebhookController {
  private readonly logger = new Logger(ScmWebhookController.name);

  constructor(
    private readonly scm: ScmService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('webhook/:provider')
  @HttpCode(202)
  async receive(
    @Param('provider') providerParam: string,
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
  ): Promise<{ received: boolean; deduped?: boolean; ignored?: boolean }> {
    const provider = providerParam as ScmProvider;
    if (!PROVIDERS.has(provider)) throw new BadRequestException('Unknown SCM provider');

    const secret = this.config.get('GITHUB_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException('SCM webhook secret not configured');

    const raw = req.rawBody;
    if (!raw || !signature) throw new UnauthorizedException('Missing signature or body');
    this.verifySignature(raw, signature, secret);

    if (!event || !deliveryId) throw new BadRequestException('Missing event/delivery headers');
    if (!HANDLED_EVENTS.has(event)) {
      // ping, issues, etc. — acknowledge without persisting.
      return { received: true, ignored: true };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON body');
    }

    const { inserted } = await this.scm.ingestWebhook(provider, deliveryId, event, payload);
    return { received: true, deduped: !inserted };
  }

  /** Constant-time compare of `sha256=<hex>` over the raw body. */
  private verifySignature(raw: Buffer, signature: string, secret: string): void {
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Rejected SCM webhook: invalid signature');
      throw new UnauthorizedException('Invalid signature');
    }
  }
}
