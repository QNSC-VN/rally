import { describe, expect, it } from 'vitest'

import { pctOfCapacity, planTotals } from './plan-totals'
import type { CapacityPlan } from './api'

type Team = CapacityPlan['teams'][number]
type Allocation = CapacityPlan['allocations'][number]

const team = (over: Partial<Team> = {}): Team =>
  ({
    id: 'pt-1',
    teamId: 'team-1',
    teamName: 'Alpha',
    capacity: 100,
    cutlineIndex: null,
    metrics: { complete: 10, rollup: 40, estimated: 60, capacity: 100, warnings: [] },
    ...over,
  }) as Team

const allocation = (over: Partial<Allocation> = {}): Allocation =>
  ({
    id: `alloc-${over.portfolioItemId ?? 'x'}-${over.teamId ?? 'none'}`,
    portfolioItemId: 'fe-1',
    itemKey: 'FE-1',
    name: 'A feature',
    teamId: 'team-1',
    value: 20,
    tier: 'allocated',
    metrics: { complete: 0, rollup: 0, estimated: 20, capacity: null, warnings: [] },
    ...over,
  }) as Allocation

const plan = (over: Partial<CapacityPlan> = {}): CapacityPlan =>
  ({ teams: [team()], allocations: [], unallocated: 0, ...over }) as CapacityPlan

describe('planTotals', () => {
  it('sums the team rows', () => {
    const totals = planTotals(
      plan({
        teams: [
          team(),
          team({
            id: 'pt-2',
            teamId: 'team-2',
            metrics: { complete: 5, rollup: 5, estimated: 15, capacity: 50, warnings: [] },
          }),
        ],
      }),
    )
    expect(totals).toMatchObject({ complete: 15, rollup: 45, estimated: 75, capacity: 150 })
  })

  it('totals capacity over teams that HAVE one, and stays null while none does', () => {
    // Summing nulls as zero would report a plan nobody has sized as a plan with no capacity
    // available — which reads as full rather than unstarted.
    const noneEntered = planTotals(
      plan({
        teams: [
          team({ metrics: { complete: 0, rollup: 0, estimated: 0, capacity: null, warnings: [] } }),
        ],
      }),
    )
    expect(noneEntered.capacity).toBeNull()

    const partly = planTotals(
      plan({
        teams: [
          team(),
          team({
            id: 'pt-2',
            teamId: 'team-2',
            metrics: { complete: 0, rollup: 0, estimated: 0, capacity: null, warnings: [] },
          }),
        ],
      }),
    )
    expect(partly.capacity).toBe(100)
  })

  it('counts ITEMS, not allocation rows', () => {
    // A Feature shared between two teams is one assigned item, not two — the same way Rally's
    // header counts them.
    const totals = planTotals(
      plan({
        allocations: [
          allocation({ portfolioItemId: 'fe-1', teamId: 'team-1' }),
          allocation({ portfolioItemId: 'fe-1', teamId: 'team-2' }),
          allocation({ portfolioItemId: 'fe-2', teamId: 'team-1' }),
        ],
      }),
    )
    expect(totals.assignedItems).toBe(2)
    expect(totals.unassignedItems).toBe(0)
  })

  it('counts a team-less allocation as unassigned', () => {
    const totals = planTotals(
      plan({
        allocations: [
          allocation({ portfolioItemId: 'fe-1', teamId: null }),
          allocation({ portfolioItemId: 'fe-2', teamId: 'team-1' }),
        ],
      }),
    )
    expect(totals).toMatchObject({ assignedItems: 1, unassignedItems: 1 })
  })

  it('treats a Feature that is BOTH allocated and parked as assigned', () => {
    // It has a plan. Counting it in both columns would make the two add up to more items than
    // the plan holds.
    const totals = planTotals(
      plan({
        allocations: [
          allocation({ portfolioItemId: 'fe-1', teamId: null }),
          allocation({ portfolioItemId: 'fe-1', teamId: 'team-1' }),
        ],
      }),
    )
    expect(totals).toMatchObject({ assignedItems: 1, unassignedItems: 0 })
  })

  it('is all zeros for an empty plan', () => {
    expect(planTotals(plan({ teams: [] }))).toEqual({
      complete: 0,
      rollup: 0,
      estimated: 0,
      capacity: null,
      assignedItems: 0,
      unassignedItems: 0,
    })
  })
})

describe('pctOfCapacity', () => {
  it('is a whole percentage of capacity', () => {
    expect(pctOfCapacity(25, 100)).toBe(25)
    expect(pctOfCapacity(1, 3)).toBe(33)
  })

  it('exceeds 100 rather than clamping, because being over is the point', () => {
    expect(pctOfCapacity(150, 100)).toBe(150)
  })

  it('has no answer without a base', () => {
    // Null and zero both mean "no ceiling to measure against" — dividing would print Infinity%.
    expect(pctOfCapacity(10, null)).toBeNull()
    expect(pctOfCapacity(10, 0)).toBeNull()
  })
})
