import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { AllocateFeatureModal } from './allocate-feature-modal'
import type { CapacityPlan } from '@/features/capacity-planning/api'

const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

const ITEM = 'item-1'

/**
 * A plan with three teams and FE-1 split across two of them, which is the state the dialog exists
 * for: Alpha holds an explicit 8, Beta was assigned WITHOUT a slice (`value: null`), and Gamma is on
 * the plan but carries nothing yet.
 */
const plan = {
  id: 'plan-1',
  teams: [
    { teamId: 'team-a', teamName: 'Team Alpha' },
    { teamId: 'team-b', teamName: 'Team Beta' },
    { teamId: 'team-c', teamName: 'Team Gamma' },
  ],
  items: [{ portfolioItemId: ITEM, itemKey: 'FE-1', name: 'Guest checkout flow' }],
  allocations: [
    {
      id: 'alloc-a',
      portfolioItemId: ITEM,
      itemKey: 'FE-1',
      name: 'x',
      teamId: 'team-a',
      value: 8,
    },
    {
      id: 'alloc-b',
      portfolioItemId: ITEM,
      itemKey: 'FE-1',
      name: 'x',
      teamId: 'team-b',
      value: null,
    },
    // Another Feature's allocation — must not appear in this dialog.
    {
      id: 'alloc-z',
      portfolioItemId: 'item-2',
      itemKey: 'FE-2',
      name: 'y',
      teamId: 'team-c',
      value: 3,
    },
  ],
} as unknown as CapacityPlan

function renderModal() {
  const onClose = vi.fn()
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrap = (node: ReactNode) =>
    render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
  wrap(<AllocateFeatureModal plan={plan} portfolioItemId={ITEM} onClose={onClose} />)
  return { onClose }
}

const teamTriggers = () => screen.getAllByRole('button', { name: 'Team' })
const estimates = () => screen.getAllByRole('textbox', { name: 'Estimate' })
const apply = () => screen.getByRole('button', { name: 'Apply' })

/** Picks a team in the Nth row through the shared searchable select. */
function chooseTeam(rowIndex: number, label: string) {
  fireEvent.click(teamTriggers()[rowIndex])
  fireEvent.click(screen.getByText(label))
}

describe('AllocateFeatureModal', () => {
  beforeEach(() => {
    mockPOST.mockReset()
    mockPATCH.mockReset()
    mockPOST.mockResolvedValue({ data: plan, error: undefined })
    mockPATCH.mockResolvedValue({ data: plan, error: undefined })
  })

  it('opens seeded with the Feature’s CURRENT split, one row per team', () => {
    // The point of Rally's dialog: a planner adding a third team can see what the first two carry.
    // The old single-team dialog showed nothing, so a split had to be remembered rather than read.
    renderModal()
    expect(teamTriggers()).toHaveLength(2)
    expect((estimates()[0] as HTMLInputElement).value).toBe('8')
    // Assigned without a slice reads as BLANK, not 0 — the two mean different things to the plan.
    expect((estimates()[1] as HTMLInputElement).value).toBe('')
    expect(screen.getByText('FE-1 — Guest checkout flow')).toBeTruthy()
  })

  it('ignores allocations belonging to other Features', () => {
    renderModal()
    expect(screen.queryByText('Team Gamma')).toBeNull()
  })

  it('adds a team in the same pass — Rally’s `Add project`', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add team' }))
    expect(teamTriggers()).toHaveLength(3)
    // Only Gamma is left: a team may hold at most one allocation of a Feature, so offering Alpha or
    // Beta again would build a dialog whose Apply is guaranteed to fail.
    fireEvent.click(teamTriggers()[2])
    // Alpha appears ONCE — as row 1's own trigger label — and not as an option in the open picker.
    expect(screen.getAllByText('Team Alpha')).toHaveLength(1)
    fireEvent.click(screen.getByText('Team Gamma'))
    fireEvent.change(estimates()[2], { target: { value: '5' } })
    fireEvent.click(apply())

    await waitFor(() => expect(mockPOST).toHaveBeenCalledTimes(1))
    expect(mockPOST.mock.calls[0][1].body).toEqual({
      portfolioItemId: ITEM,
      teamId: 'team-c',
      value: 5,
    })
    // Nothing else moved, so nothing else is written.
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('sends a blank Estimate as no value at all, not as zero', async () => {
    // Rally: "leave the Estimate field blank to allocate the entire original estimate". Sending 0
    // would allocate nothing while looking like a commitment.
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add team' }))
    chooseTeam(2, 'Team Gamma')
    fireEvent.click(apply())

    await waitFor(() => expect(mockPOST).toHaveBeenCalledTimes(1))
    expect(mockPOST.mock.calls[0][1].body).toEqual({ portfolioItemId: ITEM, teamId: 'team-c' })
  })

  it('PATCHes only the rows that moved', async () => {
    renderModal()
    fireEvent.change(estimates()[0], { target: { value: '13' } })
    fireEvent.click(apply())

    await waitFor(() => expect(mockPATCH).toHaveBeenCalledTimes(1))
    expect(mockPATCH.mock.calls[0][1].params.path.allocationId).toBe('alloc-a')
    expect(mockPATCH.mock.calls[0][1].body).toEqual({ value: 13 })
  })

  it('clears an allocation by emptying its Estimate', async () => {
    // `value: null` is a real edit: the row goes back to charging the Feature's own estimate.
    renderModal()
    fireEvent.change(estimates()[0], { target: { value: '' } })
    fireEvent.click(apply())

    await waitFor(() => expect(mockPATCH).toHaveBeenCalledTimes(1))
    expect(mockPATCH.mock.calls[0][1].body).toEqual({ value: null })
  })

  it('writes nothing when Apply is pressed on an untouched dialog', async () => {
    const { onClose } = renderModal()
    fireEvent.click(apply())

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockPOST).not.toHaveBeenCalled()
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('refuses a negative Estimate before writing anything', async () => {
    renderModal()
    fireEvent.change(estimates()[0], { target: { value: '-4' } })
    fireEvent.click(apply())

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(mockPATCH).not.toHaveBeenCalled()
  })
})
