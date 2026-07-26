/**
 * OpenTelemetry bootstrap for the API — must be the very first import in main.ts,
 * so auto-instrumentation patches HTTP, pg, ioredis and the AWS SDK before any
 * module loads them.
 *
 * The implementation is shared with the worker; see
 * the `@qnsc-vn/observability` package. Imported from its `/otel` subpath rather
 * than the package root on purpose: the root barrel reaches Nest and pino, which
 * would then be required *before* instrumentation is installed.
 *
 * Shutdown: call `shutdownOtel()` from the main.ts signal handler BEFORE
 * `app.close()`. Do NOT register a second SIGTERM handler here — main.ts owns the
 * shutdown sequence.
 */
import { startOtel, shutdownOtel } from '@qnsc-vn/observability/otel';

export { shutdownOtel };

startOtel({ defaultServiceName: 'rally-api' });
