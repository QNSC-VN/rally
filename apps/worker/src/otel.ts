/**
 * OpenTelemetry bootstrap for the worker — must be the very first import in
 * worker/main.ts, so auto-instrumentation patches pg, ioredis and the AWS SDK
 * before any module loads them.
 *
 * Shares the implementation with the API; see
 * the `@qnsc-vn/observability` package. Imported from its `/otel` subpath rather
 * than the package root on purpose: the root barrel reaches Nest and pino, which
 * would then be required *before* instrumentation is installed.
 *
 * Reads `OTEL_WORKER_SERVICE_NAME` so the two processes stay distinguishable in the
 * backend even when they share a task definition's environment.
 *
 * Shutdown: call `shutdownOtel()` from the worker's signal handler BEFORE
 * `app.close()`.
 */
import { startOtel, shutdownOtel } from '@qnsc-vn/observability/otel';

export { shutdownOtel };

startOtel({
  defaultServiceName: 'rally-worker',
  serviceNameEnvVar: 'OTEL_WORKER_SERVICE_NAME',
});
