import { metrics, Histogram, Counter, UpDownCounter, ObservableGauge } from '@opentelemetry/api';

/**
 * Abstract base class for domain-specific metrics services.
 *
 * Subclass this in each bounded context to create domain metrics.
 * All methods are no-ops when OTEL is disabled (the API returns no-op instruments).
 *
 * @example
 * ```ts
 * @Injectable()
 * export class AuthMetrics extends BaseMetrics {
 *   readonly loginTotal = this.createCounter(
 *     OTEL_METRICS.AUTH.LOGIN_TOTAL,
 *     'Total login attempts',
 *   );
 *   readonly loginFailureTotal = this.createCounter(
 *     OTEL_METRICS.AUTH.LOGIN_FAILURE_TOTAL,
 *     'Total failed login attempts',
 *   );
 * }
 * ```
 */
export abstract class BaseMetrics {
  private readonly meter = metrics.getMeter('rally', process.env['SERVICE_VERSION'] ?? 'dev');

  protected createCounter(name: string, description: string): Counter {
    return this.meter.createCounter(name, { description });
  }

  protected createHistogram(name: string, description: string, unit = 'ms'): Histogram {
    return this.meter.createHistogram(name, { description, unit });
  }

  protected createUpDownCounter(name: string, description: string): UpDownCounter {
    return this.meter.createUpDownCounter(name, { description });
  }

  protected createGauge(name: string, description: string): ObservableGauge {
    return this.meter.createObservableGauge(name, { description });
  }

  /**
   * Convenience: record a histogram value with optional attributes.
   */
  protected recordHistogram(
    histogram: Histogram,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    histogram.record(value, attributes);
  }
}
