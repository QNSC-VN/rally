import { useCallback, useMemo } from 'react'

import type { CapacityAllocation, CapacityPlan } from './api'

/** Read models over one plan, all derived from the single payload the detail endpoint returns. */
export interface PlanLookups {
  /** Team id → team name, for the many cells that carry only an id. */
  teamNameById: Map<string, string | null>
  /** A Feature's 1-based position in the PLAN's rank order. */
  rankPositionOf: (portfolioItemId: string) => number | null
  /** Who else holds a Feature — the input to Rally's `Allocation` cell. */
  sharingOf: (portfolioItemId: string) => { owner: string | null; contributors: string[] }
  /** A team's demand split into Rally's two kinds, for the `Project Capacity` rail. */
  demandOf: (teamId: string) => { assigned: number; allocated: number }
  /** Allocations bucketed by FEATURE, for the Features tab's nested rows. */
  allocationsByItem: Map<string, CapacityAllocation[]>
  /** Allocations bucketed by TEAM, for each team's sub-table. */
  allocationsByTeam: Map<string, CapacityAllocation[]>
  /** Demand parked without a team — the Unallocated bucket. */
  unallocated: CapacityAllocation[]
}

/**
 * Every lookup the plan's two grids read, in one place.
 *
 * The detail endpoint returns the whole plan in one payload — teams, items and allocation rows — and
 * both tabs then need the same handful of views over it: names by id, rank positions, who shares a
 * Feature, what a team carries. Those were memos on the page, which is where they belong logically and
 * not where they can stay: the page was over the 1024-line ratchet, and a lookup is exactly the kind
 * of thing that reads better away from the JSX it feeds.
 *
 * Every one is derived, never fetched. A second request for any of it could disagree with the grid it
 * is annotating.
 */
export function usePlanLookups(plan: CapacityPlan | undefined): PlanLookups {
  const teamNameById = useMemo(
    () => new Map(plan?.teams.map((team) => [team.teamId, team.teamName]) ?? []),
    [plan?.teams],
  )

  /**
   * Built from `plan.items`, which the API already returns in rank order — the same numbering the
   * Features tab shows, so one Feature cannot be #3 on one tab and #1 on another.
   */
  const rankPositionOf = useCallback(
    (portfolioItemId: string) => {
      const index = (plan?.items ?? []).findIndex((i) => i.portfolioItemId === portfolioItemId)
      return index === -1 ? null : index + 1
    },
    [plan?.items],
  )

  /**
   * `owner` is the team carrying the plan's assignment (our primary allocation); `contributors` are
   * the other teams it was allocated to. Both are NAMES, because Rally's cell prints names.
   */
  const sharingOf = useCallback(
    (portfolioItemId: string) => {
      const rows = (plan?.allocations ?? []).filter(
        (a) => a.portfolioItemId === portfolioItemId && a.teamId !== null,
      )
      const owner = rows.find((a) => a.isPrimary)?.teamId ?? null
      return {
        owner: owner === null ? null : (teamNameById.get(owner) ?? null),
        contributors: rows
          .filter((a) => !a.isPrimary)
          .map((a) => teamNameById.get(a.teamId as string) ?? '--'),
      }
    },
    [plan?.allocations, teamNameById],
  )

  /**
   * `allocated` is what a planner typed into an allocation row; `assigned` is what the plan charges a
   * team assigned a Feature WITHOUT a slice — the Feature's own estimate, resolved per row. The two
   * sum to the team's `metrics.estimated`, so the rail and the grid are two readings of one number.
   */
  const demandOf = useCallback(
    (teamId: string) => {
      let assigned = 0
      let allocated = 0
      for (const row of plan?.allocations ?? []) {
        if (row.teamId !== teamId) continue
        if (row.value === null) assigned += row.metrics.estimated
        else allocated += row.value
      }
      return { assigned, allocated }
    },
    [plan?.allocations],
  )

  const allocationsByItem = useMemo(() => {
    const map = new Map<string, CapacityAllocation[]>()
    for (const a of plan?.allocations ?? []) {
      const list = map.get(a.portfolioItemId) ?? []
      list.push(a)
      map.set(a.portfolioItemId, list)
    }
    return map
  }, [plan?.allocations])

  const allocationsByTeam = useMemo(() => {
    const map = new Map<string, CapacityAllocation[]>()
    for (const a of plan?.allocations ?? []) {
      if (a.teamId === null) continue
      const list = map.get(a.teamId) ?? []
      list.push(a)
      map.set(a.teamId, list)
    }
    return map
  }, [plan?.allocations])

  const unallocated = useMemo(
    () => (plan?.allocations ?? []).filter((a) => a.teamId === null),
    [plan?.allocations],
  )

  return {
    teamNameById,
    rankPositionOf,
    sharingOf,
    demandOf,
    allocationsByItem,
    allocationsByTeam,
    unallocated,
  }
}
