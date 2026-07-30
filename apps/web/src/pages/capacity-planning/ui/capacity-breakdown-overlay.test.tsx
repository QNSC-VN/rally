import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import '@/shared/i18n/i18n'
import { CapacityBreakdownOverlay } from './capacity-breakdown-overlay'
import type { CapacityPlan } from '@/features/capacity-planning/api'

type Team = CapacityPlan['teams'][number]

const team = (over: Partial<Team> & { name?: string } = {}): Team => {
  const { name, ...rest } = over
  return {
    id: `pt-${name ?? 'a'}`,
    teamId: `team-${name ?? 'a'}`,
    teamName: name ?? 'Alpha',
    capacity: 100,
    metrics: { complete: 10, rollup: 40, estimated: 60, capacity: 100, warnings: [] },
    ...rest,
  } as Team
}

const plan = (over: Partial<CapacityPlan> = {}): CapacityPlan =>
  ({
    id: 'plan-1',
    name: 'Q3',
    status: 'draft',
    unit: 'points',
    targetLoadPct: 80,
    teams: [team()],
    allocations: [],
    unallocated: 0,
    totalCapacity: 100,
    ...over,
  }) as CapacityPlan

function renderOverlay(p: CapacityPlan = plan()) {
  return render(<CapacityBreakdownOverlay plan={p} unitLabel="points" onClose={vi.fn()} />)
}

/** The row for a team, found by its row header rather than by position. */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByRole('rowheader', { name: new RegExp(name) })
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

describe('CapacityBreakdownOverlay', () => {
  it("spells out Rally's four numbers per team", () => {
    renderOverlay()
    const row = rowFor('Alpha')
    expect(row.textContent).toContain('10')
    expect(row.textContent).toContain('40')
    expect(row.textContent).toContain('60')
    expect(row.textContent).toContain('100')
  })

  it('derives Remaining as capacity minus committed demand', () => {
    renderOverlay()
    // 100 − 60. Derived here rather than served: one more served field would be one more
    // number that can disagree with the two it is computed from.
    expect(rowFor('Alpha').textContent).toContain('40')
  })

  it('leaves Remaining BLANK for a team with no capacity, rather than showing 0', () => {
    // "Nothing left" and "no ceiling stated" are different answers, and only the first is
    // a planning problem.
    renderOverlay(
      plan({
        teams: [
          team({
            capacity: null,
            metrics: { complete: 0, rollup: 0, estimated: 20, capacity: null, warnings: [] },
          }),
        ],
      }),
    )
    const cells = rowFor('Alpha').querySelectorAll('td')
    expect(cells[cells.length - 1].textContent).toBe('—')
  })

  it('totals capacity over teams that HAVE one, and stays blank while none does', () => {
    renderOverlay(
      plan({
        teams: [
          team({ name: 'Alpha' }),
          team({
            name: 'Beta',
            capacity: null,
            metrics: { complete: 0, rollup: 5, estimated: 15, capacity: null, warnings: [] },
          }),
        ],
      }),
    )
    // Alpha 100 + Beta (none) = 100, NOT 100 + 0 presented as a complete picture.
    const footer = screen.getByRole('row', { name: /Total/ })
    expect(footer.textContent).toContain('100')
    // Estimated totals across both: 60 + 15.
    expect(footer.textContent).toContain('75')
  })

  it('reports a missing capacity in the totals instead of summing nulls as zero', () => {
    renderOverlay(
      plan({
        totalCapacity: null,
        teams: [
          team({
            capacity: null,
            metrics: { complete: 0, rollup: 0, estimated: 0, capacity: null, warnings: [] },
          }),
        ],
      }),
    )
    // A plan nobody has entered capacity for is not a plan with zero capacity available.
    expect(screen.getByRole('row', { name: /Total/ }).textContent).toContain('Not entered')
  })

  it('carries each team’s warnings as text, not just an icon', () => {
    renderOverlay(
      plan({
        teams: [
          team({
            capacity: null,
            metrics: {
              complete: 0,
              rollup: 30,
              estimated: 10,
              capacity: null,
              warnings: ['team_missing_capacity', 'rollup_exceeds_estimated'],
            },
          }),
        ],
      }),
    )
    const glyph = screen.getByRole('img', { name: /No capacity entered/ })
    expect(glyph.getAttribute('title')).toContain('outgrown')
  })

  it('shows unallocated demand, which no team row accounts for', () => {
    // Excluded from every team row by design, so a breakdown that only listed teams would
    // lose it — and it is the number a planner wants when the totals do not add up.
    renderOverlay(plan({ unallocated: 25 }))
    expect(screen.getByText(/Unallocated demand/)).toBeTruthy()
    expect(screen.getByText('25')).toBeTruthy()
  })

  it('says so plainly when the plan has no teams yet', () => {
    renderOverlay(plan({ teams: [] }))
    expect(screen.getByText(/Add a team/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
