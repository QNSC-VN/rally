import type { CapacityPlan } from './api'

export interface PlanTotals {
  complete: number
  rollup: number
  estimated: number
  /**
   * Sum of the capacities ENTERED so far, or null while none has been.
   *
   * Null rather than 0 because "nobody has stated a ceiling" and "the ceiling is zero" are
   * different answers, and only the second means the plan is full.
   */
  capacity: number | null
  /** Features with a team — Rally's "Assigned". */
  assignedItems: number
  /** Features parked in the Unallocated bucket — Rally shows this in yellow. */
  unassignedItems: number
}

/**
 * Plan-level totals, summed from the team rows the API already returns.
 *
 * ONE definition for every surface that shows them — the summary strip and the Breakdown
 * overlay both read this, so the two cannot disagree. Computed client-side rather than served
 * because it is a sum over data already in the response; a served field would be one more
 * number able to drift from the rows beneath it.
 *
 * Items are counted by DISTINCT Feature, not by allocation row: a Feature shared between two
 * teams is one item that is assigned, not two. Rally's header counts items the same way.
 */
export function planTotals(plan: CapacityPlan): PlanTotals {
  const totals = plan.teams.reduce(
    (acc, team) => ({
      complete: acc.complete + team.metrics.complete,
      rollup: acc.rollup + team.metrics.rollup,
      estimated: acc.estimated + team.metrics.estimated,
      capacity:
        team.metrics.capacity === null ? acc.capacity : (acc.capacity ?? 0) + team.metrics.capacity,
    }),
    { complete: 0, rollup: 0, estimated: 0, capacity: null as number | null },
  )

  const assigned = new Set<string>()
  const unassigned = new Set<string>()
  for (const allocation of plan.allocations) {
    if (allocation.teamId === null) unassigned.add(allocation.portfolioItemId)
    else assigned.add(allocation.portfolioItemId)
  }
  // A Feature allocated to a team AND parked unallocated counts as assigned: it has a plan.
  for (const id of assigned) unassigned.delete(id)

  return {
    ...totals,
    assignedItems: assigned.size,
    unassignedItems: unassigned.size,
  }
}

/**
 * `value` as a whole percentage of the plan's capacity, or null when there is no base.
 *
 * Rally shows these percentages against capacity, so a plan with no capacity entered shows the
 * numbers without percentages rather than dividing by zero and printing `Infinity%`.
 */
export function pctOfCapacity(value: number, capacity: number | null): number | null {
  if (capacity === null || capacity <= 0) return null
  return Math.round((value / capacity) * 100)
}
