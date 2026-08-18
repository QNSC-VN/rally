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
const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

/**
 * The plan ENDS EARLIER than its release (`RE-1` runs to 08-31), which is `P5-CP-035`'s repro: it is
 * not outside its release and is still a mismatch, because AC-019 compares the two windows for
 * EQUALITY. The advisory copy has to survive exactly this case.
 */
const plan = {
  id: 'plan-1',
  projectId: 'proj-1',
  releaseId: 'rel-1',
  name: 'Q3',
  status: 'draft',
  plannedStartDate: '2026-08-07',
  plannedEndDate: '2026-08-30',
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
    mockGET.mockReset()
    // The release REFERENCE feed, which is where the advisory gets the Release's own window.
    mockGET.mockResolvedValue({
      data: [
        {
          id: 'rel-1',
          projectId: 'proj-1',
          releaseKey: 'RE-1',
          name: 'RE-1',
          status: 'planning',
          startDate: '2026-08-07',
          releaseDate: '2026-08-31',
        },
      ],
      error: undefined,
      response: { status: 200 },
    })
  })

  it('names what it will write BEFORE writing it', () => {
    // The fields land on Features outside the plan, and reverting does not undo them, so the
    // confirmation has to say both things up front.
    renderModal()
    expect(
      screen.getByText(/Each Feature assigned to a team takes this plan’s planned start and end/),
    ).toBeTruthy()
    // "exactly match", never "falls inside": AC-019 is equality, so a plan narrower than its release
    // does NOT take the Release field — the old wording promised the opposite (`P5-CP-035`).
    expect(screen.getByText(/exactly match the selected Release start and end dates/)).toBeTruthy()
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
    // Reports how many DID land, so the planner knows the publish itself worked.
    expect(screen.getByText(/1 Feature\(s\) updated/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('names BOTH date pairs on a mismatch, and never claims the plan is outside its release', async () => {
    /**
     * `P5-CP-035`. The plan runs 08-07..08-30 inside a release running 08-07..08-31, so it is not
     * outside its release at all — the old copy said "reaches outside its release", which reads as a
     * data error the planner cannot find. AC-019 compares the two windows for EQUALITY, so the honest
     * report is both windows and what was written.
     */
    mockPOST.mockResolvedValue({
      data: result({
        featuresUpdated: 1,
        skipped: [{ portfolioItemId: 'fe-2', itemKey: 'FE-2', reason: 'release_span_mismatch' }],
      }),
      error: undefined,
    })
    renderModal()
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getByText('FE-2')).toBeTruthy())
    expect(
      screen.getByText(
        /Plan dates 2026-08-07 to 2026-08-30 do not exactly match Release dates 2026-08-07 to 2026-08-31\. Planned dates were updated; Release was not changed\./,
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/outside its release/)).toBeNull()
  })

  it('reports a SPLIT Feature once, because the server reports one entry per Feature', async () => {
    // AC4: FE-2 is allocated to two teams. The advisory used to be pushed per allocation row, so the
    // planner read the same sentence twice — and React saw a duplicate key.
    mockPOST.mockResolvedValue({
      data: result({
        featuresUpdated: 1,
        skipped: [{ portfolioItemId: 'fe-2', itemKey: 'FE-2', reason: 'release_span_mismatch' }],
      }),
      error: undefined,
    })
    renderModal()
    fireEvent.click(publishButton())

    await waitFor(() => expect(screen.getAllByText('FE-2')).toHaveLength(1))
    expect(screen.getAllByText(/do not exactly match Release dates/)).toHaveLength(1)
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
