import { describe, expect, it } from 'vitest'

import { sortCapacityTeams } from './sort-teams'
import type { CapacityPlanTeam } from './api'

function team(name: string, capacity: number | null, complete = 0): CapacityPlanTeam {
  return {
    teamId: name,
    teamName: name,
    capacity,
    metrics: { complete, rollup: 0, estimated: 0, capacity, warnings: [] },
  } as unknown as CapacityPlanTeam
}

const counts = new Map([
  ['A', 3],
  ['B', 1],
  ['C', 7],
])
const countOf = (id: string) => counts.get(id) ?? 0

const names = (rows: CapacityPlanTeam[]) => rows.map((r) => r.teamName)

describe('sortCapacityTeams', () => {
  const rows = [team('B', 10), team('A', 30), team('C', null)]

  it('returns a copy in payload order when nothing is sorted', () => {
    const out = sortCapacityTeams(rows, null, null, countOf)
    expect(names(out)).toEqual(['B', 'A', 'C'])
    expect(out).not.toBe(rows)
  })

  it('sorts by name in both directions', () => {
    expect(names(sortCapacityTeams(rows, 'team', 'asc', countOf))).toEqual(['A', 'B', 'C'])
    expect(names(sortCapacityTeams(rows, 'team', 'desc', countOf))).toEqual(['C', 'B', 'A'])
  })

  it('sorts by a numeric column', () => {
    expect(names(sortCapacityTeams(rows, 'capacity', 'asc', countOf))).toEqual(['B', 'A', 'C'])
  })

  it('keeps a team with NO capacity last in BOTH directions', () => {
    // "Not entered" is not a value to rank — it is the absence of one.
    expect(names(sortCapacityTeams(rows, 'capacity', 'desc', countOf))).toEqual(['A', 'B', 'C'])
  })

  it('sorts by the injected Feature count', () => {
    expect(names(sortCapacityTeams(rows, 'features', 'desc', countOf))).toEqual(['C', 'A', 'B'])
  })

  it('breaks ties by name so the order is total', () => {
    const tied = [team('Z', 5), team('M', 5), team('Q', 5)]
    expect(names(sortCapacityTeams(tied, 'capacity', 'asc', countOf))).toEqual(['M', 'Q', 'Z'])
    // Descending keeps the SAME tie-break: the tie-break is not part of the reversal.
    expect(names(sortCapacityTeams(tied, 'capacity', 'desc', countOf))).toEqual(['M', 'Q', 'Z'])
  })
})
