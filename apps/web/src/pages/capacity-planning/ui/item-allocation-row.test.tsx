/**
 * P5-CP-025, the FEATURES-tab half: the split sub-row's `Dependencies` cell.
 *
 * The column carries two different values in two different grids, both from the BA: `0` on the
 * Features tab (SRS §157, catalog §353) and `EMPTY_VALUE` on the expanded Team table (SRS §9, §215,
 * §406, catalog §334). This sub-row is a Features-tab row, so it takes the `0` — and it used to render
 * an EMPTY cell, a third rendering nobody asked for, one row under a chip that said `0`.
 *
 * Pinned here so the split survives someone reading only one of the two grids: the pairing test is
 * `allocation-row.test.tsx`.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import '@/shared/i18n/i18n'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { ItemAllocationRow } from './item-allocation-row'
import type { CapacityAllocation } from '@/features/capacity-planning/api'

const allocation = (over: Partial<CapacityAllocation> = {}): CapacityAllocation =>
  ({
    id: 'alloc-1',
    portfolioItemId: 'fe-1',
    itemKey: 'FE-1',
    name: 'Guest checkout flow',
    teamId: 't1',
    isPrimary: true,
    state: 'developing',
    value: 8,
    source: 'manual',
    tier: 'allocated',
    estimateBreakdown: { refined: 13, preliminary: 5 },
    // Deliberately non-zero, so a `0` found on the row can only be the Dependencies chip.
    metrics: { complete: 2, rollup: 5, estimated: 8, capacity: null, warnings: [] },
    ...over,
  }) as CapacityAllocation

function renderRow() {
  render(
    <ItemAllocationRow
      allocation={allocation()}
      teamName="Team Alpha"
      teamKey="ALPHA"
      colStyleFor={() => ({})}
    />,
  )
}

describe('ItemAllocationRow — the Dependencies cell', () => {
  it("renders `0`, per §157 — the Features-tab rule, not the expanded Team table's dash", () => {
    renderRow()
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.queryByText(EMPTY_VALUE)).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('still names the team the slice belongs to', () => {
    // The control: the cell above must not be the only thing this row says.
    renderRow()
    expect(screen.getByText('Team Alpha')).toBeTruthy()
  })
})
