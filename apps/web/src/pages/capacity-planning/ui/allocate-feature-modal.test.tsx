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
 * for: Alpha committed 8 by hand, Beta carries 5 copied from the Feature's own estimate, and Gamma is
 * on the plan but holds nothing of this Feature yet.
 *
 * Every row carries a real number since 0101 — the nullable `value` and its resolve-on-read charge are
 * gone (§11), and `source` is what distinguishes a typed 8 from a copied one.
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
      isPrimary: true,
      value: 8,
      source: 'manual',
      estimateBreakdown: { refined: 5, preliminary: 5 },
    },
    {
      id: 'alloc-b',
      portfolioItemId: ITEM,
      itemKey: 'FE-1',
      name: 'x',
      teamId: 'team-b',
      isPrimary: false,
      value: 5,
      source: 'feature_estimate',
      estimateBreakdown: { refined: 5, preliminary: 5 },
    },
    // Another Feature's allocation — must not appear in this dialog.
    {
      id: 'alloc-z',
      portfolioItemId: 'item-2',
      itemKey: 'FE-2',
      name: 'y',
      teamId: 'team-c',
      value: 3,
      source: 'manual',
      estimateBreakdown: { refined: 5, preliminary: 5 },
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
    // A copied row shows its NUMBER, not a blank: the value is committed either way, and `source` is
    // what says where it came from. It used to render blank because the column held NULL.
    expect((estimates()[1] as HTMLInputElement).value).toBe('5')
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
    // §185: a blank Estimate copies the Feature's top-down estimate into the row. Omitting the field
    // is what asks the server for that copy; sending 0 would commit nothing while looking deliberate.
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

  it("re-copies the Feature's estimate by emptying an Estimate", async () => {
    // `value: null` is a real edit, and no longer a clear: the server re-copies the Feature's current
    // top-down estimate into the row and relabels it `feature_estimate` (§185).
    renderModal()
    fireEvent.change(estimates()[0], { target: { value: '' } })
    fireEvent.click(apply())

    await waitFor(() => expect(mockPATCH).toHaveBeenCalledTimes(1))
    expect(mockPATCH.mock.calls[0][1].body).toEqual({ value: null })
  })

  it('promotes a contributor team to PRIMARY, through its own endpoint', async () => {
    /**
     * Rally: "assign the portfolio item to one primary team and then allocate points to the additional
     * teams that will contribute". The choice lives here because the Features tab's assignment cell is
     * read-only for a SPLIT Feature — no single team is the answer there — and Rally has no primary
     * marker in the team table's Name column, which is where ours used to sit.
     *
     * `setPrimary` is a separate POST rather than a field on the row PATCH: the flag is exclusive per
     * Feature (`uq_capacity_allocation_primary`) and the server clears the previous holder in the same
     * transaction.
     */
    renderModal()
    // Row 2 is Team Beta, the contributor. Row 1 (Alpha) already owns the Feature.
    const radios = screen.getAllByRole('radio', { name: 'Primary team for this Feature' })
    expect(radios[0]).toBeChecked()
    fireEvent.click(radios[1])
    fireEvent.click(apply())

    await waitFor(() => expect(mockPOST).toHaveBeenCalledTimes(1))
    expect(mockPOST.mock.calls[0][0]).toContain('primary')
    expect(mockPOST.mock.calls[0][1].params.path.allocationId).toBe('alloc-b')
    // Nothing else moved, so no row was patched.
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('does not re-promote the team that is already primary', async () => {
    // Clicking the row that already owns the Feature is a no-op, not a redundant write.
    renderModal()
    fireEvent.click(screen.getAllByRole('radio', { name: 'Primary team for this Feature' })[0])
    fireEvent.click(apply())

    await waitFor(() => expect(mockPOST).not.toHaveBeenCalled())
    expect(mockPATCH).not.toHaveBeenCalled()
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
