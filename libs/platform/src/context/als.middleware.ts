import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContextService } from './request-context';

/**
 * Seeds AsyncLocalStorage context on every inbound request.
 * Sets correlationId from inbound header or generates a new one.
 * tenantId/userId remain undefined until JwtAuthGuard populates them post-auth.
 */
@Injectable()
export class AsyncLocalStorageMiddleware implements NestMiddleware {
  constructor(private readonly ctx: RequestContextService) {}

  use(
    req: { headers: Record<string, string | string[] | undefined> },
    res: { setHeader(name: string, value: string): void },
    next: () => void,
  ): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ||
      (req.headers['x-request-id'] as string | undefined) ||
      randomUUID();

    res.setHeader('x-correlation-id', correlationId);

    this.ctx.run(
      {
        tenantId: undefined,
        userId: undefined,
        sessionId: undefined,
        correlationId,
        traceparent: req.headers['traceparent'] as string | undefined,
      },
      next,
    );
  }
}
