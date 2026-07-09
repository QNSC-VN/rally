import { AsyncLocalStorage } from 'async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContext {
  workspaceId: string | undefined;
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
    return als.run(context, fn);
  }

  get(): RequestContext | undefined {
    return als.getStore();
  }

  getOrThrow(): RequestContext {
    const ctx = als.getStore();
    if (!ctx) throw new Error('No request context in AsyncLocalStorage');
    return ctx;
  }

  getWorkspaceId(): string | undefined {
    return als.getStore()?.workspaceId;
  }

  getUserId(): string | undefined {
    return als.getStore()?.userId;
  }

  getCorrelationId(): string | undefined {
    return als.getStore()?.correlationId;
  }

  /** Mutate workspace + user once populated from JWT in JwtAuthGuard */
  setAuthContext(workspaceId: string | undefined, userId: string, sessionId: string): void {
    const ctx = als.getStore();
    if (ctx) {
      ctx.workspaceId = workspaceId;
      ctx.userId = userId;
      ctx.sessionId = sessionId;
    }
  }
}
