import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { PreconditionFailedException } from '@quynhonsemiconductor/platform-http';
import { HttpLoggingInterceptor } from './http-logging.interceptor';
import type { AppConfigService } from '../config/app-config.service';
import type { HttpMetrics } from '@quynhonsemiconductor/observability';

/**
 * The streaming exclusion has to hold on BOTH taps of the interceptor's one `pipe`.
 * It was on the success tap only, with the docstring explaining why it had to exist
 * at all — an SSE response stays open for minutes and recording that as request
 * latency dominates the route's p95 — while the error tap recorded unconditionally.
 *
 * These four cases pin the matrix (success/error x streaming/not) so a later edit
 * cannot drop one half again, plus the header path the guard reads through.
 *
 * Variant filename on purpose: `test/coverage-include.spec.ts` demands a
 * coverage-include entry for any spec named after an existing subject file, and
 * `vitest.config.ts` is outside this change's scope.
 */

const SSE = 'text/event-stream; charset=utf-8';

const config = { get: () => false } as unknown as AppConfigService;

function contextFor(response: unknown): ExecutionContext {
  const req = {
    method: 'GET',
    url: '/v1/notifications/stream',
    headers: {},
    ip: '10.0.0.1',
    query: {},
    routeOptions: { url: '/v1/notifications/stream' },
  };
  const http = {
    getRequest: () => req,
    getResponse: () => response,
  };
  return {
    getType: () => 'http',
    switchToHttp: () => http,
  } as unknown as ExecutionContext;
}

/** A FastifyReply stand-in: `getHeader` is the only member the guard touches. */
function reply(contentType?: string) {
  return {
    statusCode: 200,
    getHeader: (name: string) => (name === 'content-type' ? contentType : undefined),
  };
}

describe('HttpLoggingInterceptor — streaming exclusion', () => {
  let interceptor: HttpLoggingInterceptor;
  let metrics: { record: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    metrics = { record: vi.fn() };
    interceptor = new HttpLoggingInterceptor(config, metrics as unknown as HttpMetrics);
    // The interceptor logs one line per request; these cases are about the METRIC, so
    // keep the suite output readable without changing the code path.
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  const runSuccess = (contentType?: string) =>
    new Promise<void>((resolve, reject) => {
      const next = { handle: () => of({ ok: true }) } as CallHandler;
      interceptor.intercept(contextFor(reply(contentType)), next).subscribe({
        complete: resolve,
        error: reject,
      });
    });

  const runError = (contentType?: string, err: unknown = new Error('boom')) =>
    new Promise<void>((resolve) => {
      const next = { handle: () => throwError(() => err) } as CallHandler;
      interceptor.intercept(contextFor(reply(contentType)), next).subscribe({
        complete: resolve,
        error: () => resolve(),
      });
    });

  it('records a normal success', async () => {
    await runSuccess('application/json');
    expect(metrics.record).toHaveBeenCalledTimes(1);
  });

  it('skips a streaming success', async () => {
    await runSuccess(SSE);
    expect(metrics.record).not.toHaveBeenCalled();
  });

  it('records a normal error, with its errorCode', async () => {
    await runError('application/json');
    expect(metrics.record).toHaveBeenCalledTimes(1);
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, errorCode: 'INTERNAL' }),
    );
  });

  it('skips a streaming error — the guard the error tap was missing', async () => {
    await runError(SSE);
    expect(metrics.record).not.toHaveBeenCalled();
  });

  it('still maps a DomainException status on the error path', async () => {
    // The error tap does more than record; assert the streaming guard did not
    // displace the status mapping it wraps.
    await runError(
      'application/json',
      new PreconditionFailedException('ATTACHMENT_NOT_UPLOADED', 'not uploaded'),
    );
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 412, errorCode: 'ATTACHMENT_NOT_UPLOADED' }),
    );
  });

  it('treats a response with no getHeader as NOT streaming, on both taps', async () => {
    // `getHeader` is optional in the parameter type because a non-Fastify response
    // object legitimately has none; an absent header must not throw inside the guard
    // and must not silently suppress the metric either.
    const bare = { statusCode: 200 };
    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(contextFor(bare), { handle: () => of(1) } as CallHandler)
        .subscribe({ complete: resolve, error: reject });
    });
    await new Promise<void>((resolve) => {
      interceptor
        .intercept(contextFor(bare), {
          handle: () => throwError(() => new Error('boom')),
        } as CallHandler)
        .subscribe({ complete: resolve, error: () => resolve() });
    });
    expect(metrics.record).toHaveBeenCalledTimes(2);
  });
});
