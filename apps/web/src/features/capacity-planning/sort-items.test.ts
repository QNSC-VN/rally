import { describe, expect, it } from 'vitest'

import { isRankOrder, sortCapacityItems } from './sort-items'
import type { CapacityPlanItem } from './api'

const item = (over: Partial<CapacityPlanItem>): CapacityPlanItem =>
  ({
    portfolioItemId: 'x',
    itemKey: 'FE-1',
    name: 'A',
    rank: 'a',
    projectId: 'p1',
    projectName: 'NX Platform',
    releaseId: null,
    estimated: 0,
    rollup: 0,
    complete: 0,
    tier: 'none',
    teamIds: [],
    primaryTeamId: null,
    unallocated: true,
    ...over,
  }) as CapacityPlanItem

/** Rank order is what the API returns, so the fixture's array order IS the rank order. */
const items = [
  item({
    portfolioItemId: '1',
    itemKey: 'FE-3',
    name: 'Checkout',
    rollup: 5,
    estimated: 8,
    complete: 1,
    primaryTeamId: 'tb',
  }),
  item({
    portfolioItemId: '2',
    itemKey: 'FE-1',
    name: 'address book',
    rollup: 21,
    estimated: 3,
    complete: 0,
    primaryTeamId: 'ta',
  }),
  item({
    portfolioItemId: '3',
    itemKey: 'FE-2',
    name: 'Billing',
    rollup: 13,
    estimated: 21,
    complete: 8,
    primaryTeamId: null,
  }),
]

const teamNameOf = (teamId: string | null) =>
  teamId === null ? null : teamId === 'ta' ? 'Team Alpha' : 'Team Beta'

const keys = (rows: CapacityPlanItem[]) => rows.map((r) => r.itemKey)

describe('isRankOrder', () => {
  it('treats no sort as rank ascending, because that is the order the plan arrives in', () => {
    // The cutline and the drag grip are defined only here — Rally draws the line "only when you sort
    // portfolio items by rank in ascending order", and the grid opens in exactly that order.
    expect(isRankOrder(null, null)).toBe(true)
    expect(isRankOrder('rank', 'asc')).toBe(true)
  })

  it('is false for rank DESCENDING and for every other column', () => {
    expect(isRankOrder('rank', 'desc')).toBe(false)
    expect(isRankOrder('name', 'asc')).toBe(false)
    expect(isRankOrder('estimated', 'desc')).toBe(false)
  })
})

describe('sortCapacityItems', () => {
  it('leaves rank order exactly as the API returned it', () => {
    // Not re-derived from the LexoRank string: that sorts as text, so `a10` would land before `a9`.
    expect(keys(sortCapacityItems(items, null, null, teamNameOf))).toEqual(['FE-3', 'FE-1', 'FE-2'])
    expect(keys(sortCapacityItems(items, 'rank', 'asc', teamNameOf))).toEqual([
      'FE-3',
      'FE-1',
      'FE-2',
    ])
    expect(keys(sortCapacityItems(items, 'rank', 'desc', teamNameOf))).toEqual([
      'FE-2',
      'FE-1',
      'FE-3',
    ])
  })

  it('sorts names case-insensitively, so lowercase does not sort into its own block', () => {
    expect(keys(sortCapacityItems(items, 'name', 'asc', teamNameOf))).toEqual([
      'FE-1',
      'FE-2',
      'FE-3',
    ])
  })

  it('sorts the assignment by TEAM NAME, not by id', () => {
    // The reader compares names; ids would produce an order nothing on screen explains.
    expect(keys(sortCapacityItems(items, 'assignment', 'asc', teamNameOf))).toEqual([
      'FE-1',
      'FE-3',
      'FE-2',
    ])
  })

  it('keeps an unassigned Feature last in BOTH directions', () => {
    // It is the row with no answer, not the smallest answer — Rally flags it rather than
    // interleaving it, and flipping the direction must not promote it to the top.
    const asc = sortCapacityItems(items, 'assignment', 'asc', teamNameOf)
    const desc = sortCapacityItems(items, 'assignment', 'desc', teamNameOf)
    expect(asc[asc.length - 1].itemKey).toBe('FE-2')
    expect(desc[desc.length - 1].itemKey).toBe('FE-2')
  })

  it('sorts each numeric column on its own value', () => {
    expect(keys(sortCapacityItems(items, 'rollup', 'asc', teamNameOf))).toEqual([
      'FE-3',
      'FE-2',
      'FE-1',
    ])
    expect(keys(sortCapacityItems(items, 'estimated', 'desc', teamNameOf))).toEqual([
      'FE-2',
      'FE-3',
      'FE-1',
    ])
    expect(keys(sortCapacityItems(items, 'complete', 'asc', teamNameOf))).toEqual([
      'FE-1',
      'FE-3',
      'FE-2',
    ])
  })

  it('leaves the order alone for the reserved Dependencies column', () => {
    // Every Feature reports zero until there is a dependency model, so the sort is a stable no-op
    // rather than a missing case that throws.
    expect(keys(sortCapacityItems(items, 'dependencies', 'asc', teamNameOf))).toEqual([
      'FE-3',
      'FE-1',
      'FE-2',
    ])
  })

  it('does not mutate the array it was given', () => {
    const before = keys(items)
    sortCapacityItems(items, 'name', 'desc', teamNameOf)
    expect(keys(items)).toEqual(before)
  })
})
