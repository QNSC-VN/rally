import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

import '@/shared/i18n/i18n'
import { FeatureChildrenTable } from './feature-children-table'
import type { PortfolioChild } from '@/features/portfolio/api'

const child = (over: Partial<PortfolioChild> = {}): PortfolioChild =>
  ({
    id: 'c1',
    itemKey: 'US-1',
    type: 'story',
    title: 'Upgrade the workspace',
    scheduleState: 'completed',
    storyPoints: 5,
    priority: 'high',
    iterationId: 'it-1',
    iterationName: 'Sprint 26.1',
    projectId: 'p1',
    releaseId: 'r1',
    teamId: 't1',
    assigneeId: 'u1',
    releaseName: 'v2.0',
    projectName: 'NX Platform',
    teamName: 'Team Alpha',
    ownerName: 'Admin User',
    ...over,
  }) as PortfolioChild

describe('FeatureChildrenTable', () => {
  it('renders every column the BA lists, including the two that were not on the wire', () => {
    // `Priority` and `Iteration` had no source until this slice added them to the children query, so
    // six of the BA's nine columns could not be shown at all.
    render(<FeatureChildrenTable children={[child()]} />)
    for (const heading of [
      'Type',
      'ID',
      'Name',
      'Priority',
      'Est',
      'Owner',
      'Schedule State',
      'Iteration',
      'Release',
    ]) {
      expect(screen.getByText(heading)).toBeTruthy()
    }
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('Sprint 26.1')).toBeTruthy()
  })

  it('foots the Est column, which is the one total the BA asks for', () => {
    render(
      <FeatureChildrenTable
        children={[child(), child({ id: 'c2', itemKey: 'US-2', storyPoints: 3 })]}
      />,
    )
    expect(screen.getByText('Totals (2)')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })

  it('shows a DASH for an unestimated child rather than zero', () => {
    // A Story nobody has sized is not a Story worth zero points, and the total must not pretend it is.
    render(<FeatureChildrenTable children={[child({ storyPoints: null })]} />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('Totals (1)')).toBeTruthy()
  })

  it('narrows on search, and the TOTAL follows the visible rows', () => {
    // A total that ignored the search would disagree with the rows above it, and nothing on screen
    // would say which set it described.
    render(
      <FeatureChildrenTable
        children={[
          child(),
          child({ id: 'c2', itemKey: 'DE-9', title: 'Flaky pipeline', storyPoints: 13 }),
        ]}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search linked items' }), {
      target: { value: 'flaky' },
    })
    expect(screen.queryByText('Upgrade the workspace')).toBeNull()
    expect(screen.getByText('Totals (1)')).toBeTruthy()
    // TWICE: the surviving row's own Est and the total, which is the point — with one row visible the
    // two must agree, and the 5-point row that was filtered out contributes to neither.
    expect(screen.getAllByText('13')).toHaveLength(2)
    expect(screen.queryByText('18')).toBeNull()
  })

  it('says the list is EMPTY differently from "nothing matched"', () => {
    // Two different situations for a reader: a Feature with no linked work, and a search that hid it.
    const { unmount } = render(<FeatureChildrenTable children={[]} />)
    expect(screen.getByText('Nothing linked yet.')).toBeTruthy()
    unmount()

    render(<FeatureChildrenTable children={[child()]} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search linked items' }), {
      target: { value: 'zzzz' },
    })
    expect(screen.getByText('No linked item matches that search.')).toBeTruthy()
  })
})
