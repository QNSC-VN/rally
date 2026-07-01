/**
 * OpenTelemetry bootstrap for the worker process.
 * Must be the very first import in worker/main.ts.
 *
 * Shutdown: call shutdownOtel() from main.ts signal handler BEFORE app.close().
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import { randomUUID } from 'node:crypto';

const isEnabled = process.env['OTEL_ENABLED'] === 'true';
const isProd = process.env['NODE_ENV'] === 'production';

const samplingProbability = parseFloat(
  process.env['OTEL_SAMPLING_PROBABILITY'] ?? (isProd ? '0.1' : '1.0'),
);

let _sdk: NodeSDK | undefined;

/**
 * Flush pending spans and shut down the SDK.
 * Called from worker/main.ts shutdown handler before app.close().
 */
export async function shutdownOtel(): Promise<void> {
  if (_sdk) {
    await _sdk.shutdown();
  }
}

if (isEnabled) {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  _sdk = new NodeSDK({
    serviceName: process.env['OTEL_WORKER_SERVICE_NAME'] ?? 'rally-worker',

    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env['OTEL_WORKER_SERVICE_NAME'] ?? 'rally-worker',
      [ATTR_SERVICE_VERSION]: process.env['SERVICE_VERSION'] ?? 'dev',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env['NODE_ENV'] ?? 'development',
      'service.instance.id': randomUUID(),
    }),

    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingProbability),
    }),

    spanProcessors: [
      new BatchSpanProcessor(traceExporter, {
        maxExportBatchSize: isProd ? 200 : 50,
        exportTimeoutMillis: isProd ? 5_000 : 2_000,
        scheduledDelayMillis: isProd ? 2_000 : 1_000,
      }),
    ],

    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: isProd ? 30_000 : 10_000,
    }),

    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-pg': { enabled: true },
        '@opentelemetry/instrumentation-ioredis': { enabled: true },
        '@opentelemetry/instrumentation-aws-sdk': { enabled: true },
        // Worker has no HTTP server — HTTP client instrumentation still useful for outgoing calls
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  _sdk.start();
}
