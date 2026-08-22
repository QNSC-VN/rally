type DateRange = { startDate?: string | null; endDate?: string | null }

/** `start - end` label for an iteration, with em-dash fallbacks for missing bounds. */
export function fmtRange(it: DateRange): string {
  const s = it.startDate ?? '--'
  const e = it.endDate ?? '--'
  return `${s} - ${e}`
}

/** Inclusive day count for an iteration; defaults to 10 when bounds are missing. */
export function computeTotalDays(it: DateRange | undefined): number {
  if (!it?.startDate || !it?.endDate) return 10
  const start = new Date(it.startDate)
  const end = new Date(it.endDate)
  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return Math.max(1, diff)
}

/** One scoped Story/Defect row, in the only fields the Totals row reads. */
export type TotalsRow = {
  planEstimate?: number | null
  toDo?: number | null
  actual?: number | null
}

/**
 * The Totals row under the column header — `P2-IS-FR-016B/016C`, over the SCOPED parents.
 *
 * `taskEst` is `To Do + Actual`, NOT the sum of the `Task Est` column. The BA states that twice —
 * FR-016C ("Task Est total sums child Task `To Do + Actual`") and §240's mapping table ("Sum child
 * Task `toDo + actuals` for scoped Story/Defect parents") — so it is the requirement, not a slip.
 *
 * It therefore does not equal the column above it, and that is inherent to the definition rather
 * than an arithmetic bug: the column is Rally's `TaskEstimateTotal`, a rollup of each Task's own
 * Estimate (§203), while this total is remaining plus spent. The two agree only while nothing has
 * been logged. Raised with the BA; if they mean the column's sum, `toDo + actual` here is the one
 * expression to change back.
 */
export function iterationStatusTotals(rows: readonly TotalsRow[]): {
  planEst: number
  taskEst: number
  toDoSum: number
  count: number
} {
  let planEst = 0
  let taskEst = 0
  let toDoSum = 0
  for (const row of rows) {
    planEst += row.planEstimate ?? 0
    taskEst += (row.toDo ?? 0) + (row.actual ?? 0)
    toDoSum += row.toDo ?? 0
  }
  return { planEst, taskEst, toDoSum, count: rows.length }
}
