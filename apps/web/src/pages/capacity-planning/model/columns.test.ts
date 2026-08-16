/**
 * P5-CP-030 — the team grid's `Features` column is LEFT-aligned.
 *
 * Asserted on the ColumnSpec because the HEADER takes its alignment from here while the cell states
 * its own (`CapacityTeamRow`), so the two can disagree silently: right-aligned digits under a
 * left-aligned header is exactly the shape this column shipped with, inverted. `capacity-team-row`'s
 * own spec asserts the cell half; this one asserts the header's.
 *
 * SRS §121: "Count of allocated Features, left-aligned". It is the one number on this grid that is —
 * every other column here is a share of the capacity baseline and reads down a right edge.
 */
import { describe, expect, it } from 'vitest'

import { CAPACITY_TEAM_COLUMNS } from './columns'

describe('CAPACITY_TEAM_COLUMNS', () => {
  it('does not right-align Features', () => {
    const features = CAPACITY_TEAM_COLUMNS.find((c) => c.key === 'features')
    expect(features).toBeTruthy()
    // Absent means left — `dependencies` on the item grid relies on the same default.
    expect(features?.align).toBeUndefined()
  })

  it('still right-aligns the four capacity metrics, so the change was not a sweep', () => {
    for (const key of ['complete', 'rollup', 'estimated', 'capacity'] as const) {
      expect(CAPACITY_TEAM_COLUMNS.find((c) => c.key === key)?.align, key).toBe('right')
    }
  })
})
