/**
 * P5-CP-025 — the `Allocation` and `Dependencies` cells on a team's nested Feature table.
 *
 * The retest reports them as one defect ("own-Team Allocation and Dependencies show 0 instead of —"),
 * which they are not: the Allocation half was already closed — the pre-fix code rendered NOTHING there
 * and the only `0` in that column band belonged to Dependencies. Both are asserted here, separately.
 *
 * The cell reports a RELATIONSHIP: `from {team}` on a contributor row, `to {team}` / `N teams` on the
 * row that holds the assignment, and nothing to report when the Feature sits under its own team and
 * is allocated nowhere else. That last case rendered an EMPTY cell, which in a table where every
 * neighbour carries a value reads as "not loaded"; it now renders `EMPTY_VALUE`.
 *
 * `EMPTY_VALUE` is asserted through the constant, never as a literal `--`, and never as `—`: the BA
 * writes an em-dash in prose, the app renders `--` everywhere (see the constant's own docblock), and a
 * test that hardcoded either string would be the place that drift lands unnoticed.
 */
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { AllocationRow } from './allocation-row'
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
    metrics: { complete: 2, rollup: 5, estimated: 8, capacity: null, warnings: [] },
    ...over,
  }) as CapacityAllocation

function renderRow(
  over: Partial<CapacityAllocation> = {},
  props: { ownerTeamName?: string | null; contributorTeamNames?: string[] } = {},
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AllocationRow
        planId="plan-1"
        allocation={allocation(over)}
        canManage
        colStyleFor={() => ({})}
        onOpenFeature={() => {}}
        rankPosition={1}
        ownerTeamName={props.ownerTeamName ?? null}
        contributorTeamNames={props.contributorTeamNames ?? []}
        hasTeams
      />
    </QueryClientProvider>,
  )
}

/**
 * TWO cells in this row can hold `EMPTY_VALUE` — `Allocation` and `Dependencies` (§9 asks for a dash
 * in both) — so these assert the COUNT rather than presence. A bare `getByText(EMPTY_VALUE)` would
 * throw on the multiple match, and a bare `queryByText(...)).toBeNull()` would fail on the
 * Dependencies dash while saying nothing about the cell under test.
 */
const dashes = () => screen.queryAllByText(EMPTY_VALUE).length

describe('AllocationRow — the Allocation cell', () => {
  it("renders EMPTY_VALUE under the Feature's OWN team when nothing is allocated away", () => {
    renderRow({ isPrimary: true }, { contributorTeamNames: [] })
    // Allocation AND Dependencies.
    expect(dashes()).toBe(2)
    // Not an em-dash — the BA's prose spells it `—`, the app does not.
    expect(screen.queryByText('—')).toBeNull()
  })

  it('renders EMPTY_VALUE in the Unallocated bucket, where there is no assignment to be relative to', () => {
    renderRow({ teamId: null }, {})
    expect(dashes()).toBe(2)
  })

  it('still names the owner on a CONTRIBUTOR row rather than the placeholder', () => {
    // The control: the placeholder must not swallow the case the cell exists for.
    renderRow({ isPrimary: false }, { ownerTeamName: 'Team Alpha' })
    expect(screen.getByText('from Team Alpha')).toBeTruthy()
    // Only Dependencies — the Allocation cell has a relationship to report.
    expect(dashes()).toBe(1)
  })

  it('still names what was allocated AWAY on the assignment row', () => {
    renderRow({ isPrimary: true }, { contributorTeamNames: ['Team Beta'] })
    expect(screen.getByText('to Team Beta')).toBeTruthy()
    expect(dashes()).toBe(1)
  })

  it('renders EMPTY_VALUE in Dependencies, per §9 — and never `0` on THIS grid', () => {
    // P5-CP-025: SRS §9 says "every row shows `—`" for the expanded Team table (again at §215, §406,
    // catalog §334, Out of Scope §14). This cell rendered `0` on a COUNT reading of Rally's column and
    // the BA carried it as a P0 Fail. The Features tab keeps `0` per §157 — pinned separately in
    // `item-allocation-row.test.tsx`, so the two grids cannot be "unified" by whoever reads one of them.
    renderRow({ isPrimary: false }, { ownerTeamName: 'Team Alpha' })
    expect(dashes()).toBe(1)
    expect(screen.queryByText('0')).toBeNull()
  })
})
