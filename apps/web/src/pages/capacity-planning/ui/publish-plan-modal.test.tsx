import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { PublishPlanModal } from './publish-plan-modal'
import type { CapacityPlan, PublishResult } from '@/features/capacity-planning/api'

const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>

const plan = {
  id: 'plan-1',
  name: 'Q3',
  status: 'draft',
  plannedStartDate: '2026-07-01',
  plannedEndDate: '2026-07-31',
} as unknown as CapacityPlan

const result = (over: Partial<PublishResult> = {}): PublishResult =>
  ({
    plan,
    fieldsUpdated: true,
    featuresUpdated: 2,
    skipped: [],
    ...over,
  }) as PublishResult

function renderModal(over: Partial<CapacityPlan> = {}) {
  const onClose = vi.fn()
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrap = (node: ReactNode) =>
    render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
  wrap(<PublishPlanModal plan={{ ...plan, ...over }} onClose={onClose} />)
  return { onClose }
}

const publishButton = () => screen.getByRole('button', { name: 'Publish and update fields' })
const withoutFields = () => screen.getByRole('button', { name: 'Publish without updating fields' })

describe('PublishPlanModal', () => {
  beforeEach(() => {
    mockPOST.mockReset()
    mockPOST.mockResolvedValue({ data: result(), error: undefined })
  })

  it('names what it will write BEFORE writing it', () => {
    // The fields land on Features outside the plan, and reverting does not undo them, so the
    // confirmation has to say both things up front.
    renderModal()
    expect(screen.getByText(/planned start and end dates/)).toBeTruthy()
    expect(screen.getByText(/only when the plan’s window falls inside its release/)).toBeTruthy()
    expect(screen.getByText(/does NOT undo these field values/)).toBeTruthy()
  })

  it('says up front when the plan has NO window, because then nothing will be written', () => {
    /**
     * A plan created through the New Plan dialog has no window — SRS §5 gives it six fields and no
     * dates — so `Publish and update fields` writes nothing to any Feature, and it used to write NULL
     * over each one's own planned window instead. The server now leaves them alone and reports
     * `no_window`; this is the same fact said BEFORE the click, because a published plan is read-only
     * and setting the window afterwards means reverting to draft first.
     */
    renderModal({ plannedStartDate: null, plannedEndDate: null })
    expect(screen.getByText(/no dates or Release will be written/)).toBeTruthy()
  })

  it('says nothing of the sort when the plan HAS a window', () => {
    renderModal()
    expect(screen.queryByText(/no dates or Release will be written/)).toBeNull()
  })

  it('offers both of Rally’s publish choices as separate acts', () => {
    // Not one button with a checkbox: publishing for visibility and publishing to write fields
    // are different decisions.
    renderModal()
    expect(publishButton()).toBeTruthy()
    expect(withoutFields()).toBeTruthy()
  })

  it('sends updateFields TRUE for the primary button', async () => {
    renderModal()
    fireEvent.click(publishButton())

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect(mockPOST.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'plan-1' } },
      body: { updateFields: true },
    })
  })

  it('sends updateFields FALSE for publish-without-fields', async () => {
    renderModal()
    fireEvent.click(withoutFields())

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect(mockPOST.mock.calls[0][1]).toMatchObject({ body: { updateFields: false } })
  })

  it('closes straight away when nothing was skipped', async () => {
    const { onClose } = renderModal()
    fireEvent.click(publishButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('STAYS OPEN and lists what was skipped, with the reason per Feature', async () => {
    // A publish that wrote 3 of 5 succeeded; a toast cannot carry which two need fixing.
    mockPOST.mockResolvedValue({
      data: result({
        featuresUpdated: 1,
        skipped: [
          { portfolioItemId: 'fe-1', itemKey: 'FE-1', reason: 'unallocated' },
          { portfolioItemId: 'fe-2', itemKey: 'FE-2', reason: 'release_span_mismatch' },
        ],
      }),
      error: undefined,
    })
    const { onClose } = renderModal()
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByText('FE-1')).toBeTruthy())
    expect(screen.getByText(/no team assigned/)).toBeTruthy()
    expect(screen.getByText('FE-2')).toBeTruthy()
    expect(screen.getByText(/reaches outside its release/)).toBeTruthy()
    // Reports how many DID land, so the planner knows the publish itself worked.
    expect(screen.getByText(/1 Feature\(s\) updated/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops offering to publish once it has, so a report cannot be re-submitted', async () => {
    mockPOST.mockResolvedValue({
      data: result({
        skipped: [{ portfolioItemId: 'fe-1', itemKey: 'FE-1', reason: 'unallocated' }],
      }),
      error: undefined,
    })
    renderModal()
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Publish and update fields' })).toBeNull()
  })

  it('surfaces a refusal instead of closing as though it worked', async () => {
    // e.g. CAPACITY_PLAN_EMPTY. Closing on an error would report success for a plan that is
    // still a draft.
    mockPOST.mockResolvedValue({
      data: undefined,
      error: { message: 'Add a team first' },
      response: { status: 422 },
    })
    const { onClose } = renderModal()
    fireEvent.click(publishButton())

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
