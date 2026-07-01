import { AsyncLocalStorage } from 'async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContext {
  tenantId: string | undefined;
  userId: string | undefined;
  sessionId: string | undefined;
  correlationId: string;
  /** W3C traceparent from inbound request */
  traceparent: string | undefined;
}

/**
 * Exported so the Pino mixin can read request context without going through DI.
 * Do NOT write to this directly — use RequestContextService.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

const als = requestContextStorage;

@Injectable()
export class RequestContextService {
  run<T>(context: RequestContext, fn: () => T): T {
    return als.run(context, fn) as T;
  }

  get(): RequestContext | undefined {
    return als.getStore();
  }

  getOrThrow(): RequestContext {
    const ctx = als.getStore();
    if (!ctx) throw new Error('No request context in AsyncLocalStorage');
    return ctx;
  }

  getTenantId(): string | undefined {
    return als.getStore()?.tenantId;
  }

  getUserId(): string | undefined {
    return als.getStore()?.userId;
  }

  getCorrelationId(): string | undefined {
    return als.getStore()?.correlationId;
  }

  /** Mutate tenant + user once populated from JWT in JwtAuthGuard */
  setAuthContext(tenantId: string, userId: string, sessionId: string): void {
    const ctx = als.getStore();
    if (ctx) {
      ctx.tenantId = tenantId;
      ctx.userId = userId;
      ctx.sessionId = sessionId;
    }
  }
}
