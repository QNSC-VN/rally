/**
 * Task time model (SRS P1-TASK-01, BA-confirmed 2026-07-20).
 *
 * A task's Estimate is a read-only value derived from its own To Do and Actual
 * hours — it is never independently editable:
 *
 *     Estimate = To Do + Actuals
 *
 * The backend is the source of truth (it stores the derived value so parent
 * roll-ups stay correct); this helper mirrors the same formula on the client so
 * inputs preview the resulting Estimate live before a save round-trips.
 */

/** numeric(8,2) column scale — keep the client preview aligned with the server. */
const HOURS_SCALE = 2

/**
 * Derive a task's Estimate from its To Do and Actual hours. Accepts the loose
 * shapes used across forms (`''`, `null`, `number`, `string`); blanks count as
 * zero. Returns a number so callers can format it however they display hours.
 */
export function deriveEstimateHours(
  todo: string | number | null | undefined,
  actual: string | number | null | undefined,
): number {
  const t = Number(todo ?? 0) || 0
  const a = Number(actual ?? 0) || 0
  return Number((t + a).toFixed(HOURS_SCALE))
}
