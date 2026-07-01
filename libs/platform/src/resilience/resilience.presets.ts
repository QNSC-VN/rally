import { ResilienceOptions, ResiliencePattern, ResiliencePreset } from './resilience.types';

/**
 * Presets tuned for specific integration categories.
 * Pass `ResiliencePreset.X` to `ResilienceService.execute(name, fn, preset)`.
 */
export const RESILIENCE_PRESETS: Record<ResiliencePreset, ResilienceOptions> = {
  [ResiliencePreset.EXTERNAL_API]: {
    patterns: [
      ResiliencePattern.RETRY,
      ResiliencePattern.CIRCUIT_BREAKER,
      ResiliencePattern.TIMEOUT,
      ResiliencePattern.BULKHEAD,
    ],
    retry: { maxAttempts: 3, useJitter: true },
    timeout: { durationMs: 30_000 },
    circuitBreaker: { failureThreshold: 5, halfOpenAfterMs: 60_000 },
    bulkhead: { maxConcurrent: 10, maxQueue: 5 },
  },

  [ResiliencePreset.DATABASE]: {
    patterns: [
      ResiliencePattern.RETRY,
      ResiliencePattern.CIRCUIT_BREAKER,
      ResiliencePattern.TIMEOUT,
    ],
    retry: { maxAttempts: 3, useJitter: true },
    timeout: { durationMs: 5_000 },
    circuitBreaker: { failureThreshold: 5, halfOpenAfterMs: 30_000 },
  },

  [ResiliencePreset.CACHE]: {
    patterns: [ResiliencePattern.TIMEOUT, ResiliencePattern.CIRCUIT_BREAKER],
    timeout: { durationMs: 500 },
    circuitBreaker: { failureThreshold: 5, halfOpenAfterMs: 30_000 },
  },

  [ResiliencePreset.EMAIL]: {
    patterns: [
      ResiliencePattern.RETRY,
      ResiliencePattern.CIRCUIT_BREAKER,
      ResiliencePattern.TIMEOUT,
      ResiliencePattern.BULKHEAD,
    ],
    retry: { maxAttempts: 5, useJitter: true },
    timeout: { durationMs: 30_000 },
    circuitBreaker: { failureThreshold: 3, halfOpenAfterMs: 120_000 },
    bulkhead: { maxConcurrent: 5, maxQueue: 10 },
  },

  /**
   * S3 / external object storage. AWS SDK has its own retry but we add a
   * circuit breaker so a full S3 degradation fails fast instead of queue-filling.
   */
  [ResiliencePreset.STORAGE]: {
    patterns: [
      ResiliencePattern.RETRY,
      ResiliencePattern.CIRCUIT_BREAKER,
      ResiliencePattern.TIMEOUT,
    ],
    retry: { maxAttempts: 3, useJitter: true },
    timeout: { durationMs: 60_000 },
    circuitBreaker: { failureThreshold: 5, halfOpenAfterMs: 60_000 },
  },
};

export const RESILIENCE_DEFAULTS: ResilienceOptions = {
  patterns: [
    ResiliencePattern.RETRY,
    ResiliencePattern.CIRCUIT_BREAKER,
    ResiliencePattern.TIMEOUT,
  ],
  retry: { maxAttempts: 3, useJitter: true },
  timeout: { durationMs: 30_000 },
  circuitBreaker: { failureThreshold: 5, halfOpenAfterMs: 60_000 },
  bulkhead: { maxConcurrent: 10, maxQueue: 5 },
};
