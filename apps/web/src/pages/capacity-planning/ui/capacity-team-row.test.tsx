/**
 * P5-CP-030 — the team row's `Features` cell is LEFT-aligned (SRS §121, "Count of allocated Features,
 * left-aligned").
 *
 * Alignment is not otherwise observable in jsdom, so this asserts the utility the cell renders with.
 * That is the load-bearing half anyway: the HEADER's alignment comes from `CAPACITY_TEAM_COLUMNS`
 * (asserted in `model/columns.test.ts`) and the CELL states its own, so the defect this pins is the
 * two disagreeing — digits hanging under nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { CapacityTeamRow } from './capacity-team-row'
import type { CapacityPlanTeam } from '@/features/capacity-planning/api'

const team = (over: Partial<CapacityPlanTeam> = {}): CapacityPlanTeam =>
  ({
    teamId: 't1',
    teamName: 'Team Alpha',
    capacity: 40,
    metrics: { complete: 2, rollup: 5, estimated: 8, capacity: 40, warnings: [] },
    ...over,
  }) as CapacityPlanTeam

function renderRow(featureCount: number) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CapacityTeamRow
        planId="plan-1"
        team={team()}
        unitLabel="points"
        canManage
        colStyleFor={() => ({})}
        gutter={null}
        onForecast={() => {}}
        expanded={false}
        onToggleExpanded={() => {}}
        featureCount={featureCount}
        featuresRequiringAttention={0}
      />
    </QueryClientProvider>,
  )
}

describe('CapacityTeamRow — the Features cell', () => {
  it('lays the count out from the LEADING edge, not against the progress bar', () => {
    renderRow(3)
    const cell = screen.getByText('3').closest('div')
    expect(cell?.className).toContain('justify-start')
    expect(cell?.className).not.toContain('justify-end')
  })
})
