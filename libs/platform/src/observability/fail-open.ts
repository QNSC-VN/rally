/**
 * Fail-open telemetry.
 *
 * Two security controls deliberately fail OPEN when Valkey is unreachable: the
 * access-token denylist (`JwtAuthGuard`) and the rate limiter (`RateLimitGuard`).
 * Both choices are right on their own — an outage should not lock every user out,
 * and rate limiting is protective rather than load-bearing — but together they
 * mean a cache outage silently accepts revoked tokens AND serves unlimited
 * traffic. Until now the only trace was a `logger.warn`, which nothing watched.
 *
 * The signal is a structured log field, not an OTel counter, because
 * `OTEL_ENABLED=false` in every deployed environment
 * (`infra/live/develop` and `infra/live/prod`) — a counter would be a no-op
 * instrument that looks like monitoring while reporting nothing. Container logs DO
 * reach CloudWatch, so each environment puts a metric filter + alarm on this field.
 *
 * When OTEL_ENABLED is turned on, add a counter alongside this log rather than
 * replacing it: the alarm depends on the field.
 */

/** Which control degraded. Values are matched by the CloudWatch metric filter. */
export type FailOpenControl = 'denylist' | 'rate_limit';

/**
 * The log field the alarm matches: `{ $.securityFailOpen = "*" }`.
 *
 * Renaming this breaks the alarm silently, so it lives here as a named constant
 * and is referenced by the metric filter's comment in the Terraform.
 */
export const FAIL_OPEN_FIELD = 'securityFailOpen';

/**
 * Build the structured payload for a fail-open event.
 *
 * @example
 * this.logger.warn(
 *   failOpenLog('denylist', { err }),
 *   'Token denylist check failed; failing open',
 * );
 */
export function failOpenLog(
  control: FailOpenControl,
  context: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...context, [FAIL_OPEN_FIELD]: control };
}
