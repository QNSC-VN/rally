/**
 * Task time model (BA-confirmed 2026-07-20, SRS P1-TASK-01).
 *
 * A task's Estimate is NEVER independently editable — it is a read-only value
 * derived from the task's own To Do and Actual hours:
 *
 *     Estimate = To Do + Actuals
 *
 * To Do and Actuals are the only manual inputs. Deriving the Estimate in one
 * place keeps every surface consistent (Add Task, Task detail, Task table and
 * the parent roll-up all read the same stored/returned value).
 */

/** Column scale for work.tasks.{estimate,todo,actual}_hours is numeric(8,2). */
const HOURS_SCALE = 2;

/**
 * Derive a task's Estimate from its To Do and Actual hours. Missing values are
 * treated as zero. The result is normalised to the column's 2-decimal scale so
 * it round-trips cleanly through the numeric column and compares equal to the
 * stored value (avoiding spurious activity-log entries on no-op updates).
 */
export function deriveTaskEstimateHours(
  todoHours: string | number | null | undefined,
  actualHours: string | number | null | undefined,
): string {
  const todo = Number(todoHours ?? 0) || 0;
  const actual = Number(actualHours ?? 0) || 0;
  return (todo + actual).toFixed(HOURS_SCALE);
}
