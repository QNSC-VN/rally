export enum ResiliencePattern {
  RETRY = 'retry',
  CIRCUIT_BREAKER = 'circuitBreaker',
  TIMEOUT = 'timeout',
  BULKHEAD = 'bulkhead',
}

export enum ResiliencePreset {
  EXTERNAL_API = 'external_api',
  DATABASE = 'database',
  CACHE = 'cache',
  EMAIL = 'email',
  STORAGE = 'storage',
}

export interface RetryOptions {
  maxAttempts: number;
  /** Adds jitter to the exponential backoff base delay. Defaults true. */
  useJitter?: boolean;
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** Milliseconds before the circuit transitions from open → half-open. */
  halfOpenAfterMs: number;
}

export interface TimeoutOptions {
  durationMs: number;
}

export interface BulkheadOptions {
  maxConcurrent: number;
  maxQueue: number;
}

export interface ResilienceOptions {
  patterns: ResiliencePattern[];
  retry?: RetryOptions;
  circuitBreaker?: CircuitBreakerOptions;
  timeout?: TimeoutOptions;
  bulkhead?: BulkheadOptions;
}

export type ResolvedResilienceOptions = Required<ResilienceOptions>;

export interface PolicyEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  policy: { execute: (fn: () => Promise<any>) => Promise<any> };
  options: ResilienceOptions;
  lastAccessedAt: number;
}

export interface ResilienceStats {
  name: string;
  circuitState: 'closed' | 'open' | 'half-open' | 'unknown';
  patterns: ResiliencePattern[];
  lastAccessedAt: number;
}
