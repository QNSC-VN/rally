import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The RELEASE end of artifact assignment (P3-REL-FR-029 "manage assigned Story/Defect work items from
 * the Release detail/artifact surface"; Q02 confirmed BOTH ends).
 *
 * A release owns no join table, so membership IS `work_items.release_id` — which is why this writes
 * through `PATCH /work-items/bulk-release`, the endpoint that already owns that column together with
 * its project scope, archived-project guard and `assertReleaseAssignable`. Removing is `releaseId:
 * null` (the mockup's "Unscheduled"), and neither direction may touch iteration or milestone
 * assignment (§7.5) — true by construction, since that is the only column the endpoint writes.
 */
vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), PUT: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      (
        ({
          'detailPage.artifacts.addButton': 'Add Artifact',
          'detailPage.artifacts.pickerTitle': 'Release Artifacts',
          'detailPage.artifacts.pickerSearch': 'Search stories and defects',
          'detailPage.artifacts.pickerConfirm': 'Save Artifacts',
        }) as Record<string, string>
      )[k] ?? k,
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The control needs `work_item:edit` on the release's own project as well as release management: the
// column it writes belongs to the work item, so the bulk endpoint checks that code, not a release one.
let grants: Record<string, boolean>
vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: (code: string) => grants[code] ?? false }),
}))

import { apiClient } from '@/shared/api/http-client'
import { ReleaseArtifactsTab } from './release-artifacts-tab'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

const IN_RELEASE = {
  id: 'wi-1',
  itemKey: 'US-1',
  type: 'story',
  title: 'Already in this release',
  scheduleState: 'defined',
  priority: 'high',
  assigneeName: 'Dev One',
  storyPoints: 5,
  teamId: null,
  releaseId: 'rel-1',
}
const UNSCHEDULED = {
  id: 'wi-2',
  itemKey: 'DE-2',
  type: 'defect',
  title: 'Not in any release',
  teamId: null,
  releaseId: null,
}
const OTHER_RELEASE = {
  id: 'wi-3',
  itemKey: 'US-3',
  type: 'story',
  title: 'In another release',
  teamId: null,
  releaseId: 'rel-9',
}

function renderTab(canManage = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ReleaseArtifactsTab releaseId="rel-1" projectId="p1" canManage={canManage} />
    </QueryClientProvider>,
  )
}

async function openPicker() {
  const add = screen.getByRole('button', { name: 'Add Artifact' })
  await waitFor(() => expect(add).toBeEnabled())
  fireEvent.click(add)
  await screen.findByRole('checkbox', { name: 'DE-2 · Not in any release' })
}

describe('ReleaseArtifactsTab', () => {
  beforeEach(() => {
    grants = { 'work_item:edit': true }
    navigate.mockReset()
    mockPATCH.mockReset()
    mockPATCH.mockResolvedValue({
      data: { updated: 1 },
      error: undefined,
      response: { status: 200 },
    })
    mockGET.mockReset()
    mockGET.mockImplementation((url: string) => {
      if (url === '/v1/releases/{id}/artifacts') {
        return Promise.resolve({
          data: {
            data: [IN_RELEASE],
            pageInfo: { hasNextPage: false, nextCursor: null, limit: 50, total: 1 },
          },
          error: undefined,
          response: { status: 200 },
        })
      }
      if (url === '/v1/work-items') {
        return Promise.resolve({
          data: { data: [IN_RELEASE, UNSCHEDULED, OTHER_RELEASE] },
          error: undefined,
          response: { status: 200 },
        })
      }
      return Promise.resolve({ data: undefined, error: undefined, response: { status: 200 } })
    })
  })

  it('renders the assigned artifacts as rows', async () => {
    renderTab()
    expect(await screen.findByText('Already in this release')).toBeInTheDocument()
  })

  it('pre-ticks exactly the items whose release is this one', async () => {
    renderTab()
    await openPicker()
    expect(screen.getByRole('checkbox', { name: 'US-1 · Already in this release' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'DE-2 · Not in any release' })).not.toBeChecked()
    // Another release's item is offered, not hidden: assigning it REPLACES that assignment (FR-031).
    expect(screen.getByRole('checkbox', { name: 'US-3 · In another release' })).not.toBeChecked()
  })

  it('ADDS an artifact by setting its release, and touches nothing else', async () => {
    renderTab()
    await openPicker()

    fireEvent.click(screen.getByRole('checkbox', { name: 'DE-2 · Not in any release' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Artifacts' }))

    await waitFor(() =>
      expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/bulk-release', {
        body: { projectId: 'p1', itemIds: ['wi-2'], releaseId: 'rel-1' },
      }),
    )
    // A diff, not a replace-set: the already-assigned item is not rewritten, and no `null` call is
    // made for items this release never held.
    expect(mockPATCH).toHaveBeenCalledTimes(1)
  })

  it('REMOVES an artifact by clearing its release to Unscheduled', async () => {
    renderTab()
    await openPicker()

    fireEvent.click(screen.getByRole('checkbox', { name: 'US-1 · Already in this release' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Artifacts' }))

    await waitFor(() =>
      expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/bulk-release', {
        body: { projectId: 'p1', itemIds: ['wi-1'], releaseId: null },
      }),
    )
    expect(mockPATCH).toHaveBeenCalledTimes(1)
  })

  it('hides the Add control from a caller who cannot edit the release', () => {
    renderTab(false)
    expect(screen.queryByRole('button', { name: 'Add Artifact' })).toBeNull()
  })

  it('hides the Add control when the caller cannot edit work items in this project', () => {
    // Release management alone is not enough: the write moves `work_items.release_id`, so the bulk
    // endpoint asks for `work_item:edit` on the release's project and would 403 without it.
    grants = {}
    renderTab(true)
    expect(screen.queryByRole('button', { name: 'Add Artifact' })).toBeNull()
  })

  it('will not open the picker until the candidate feed has arrived', async () => {
    // Deferred, not timed — the guarded failure is ordering. Opening early would freeze an empty
    // baseline into the draft, and the diff would then see nothing to add and nothing to remove: the
    // Save button would appear to work and write nothing at all.
    let releaseItems: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      releaseItems = resolve
    })
    const base = mockGET.getMockImplementation() as (url: string, opts?: unknown) => unknown
    mockGET.mockImplementation((url: string, opts: unknown) => {
      if (url === '/v1/work-items') {
        return pending.then(() => ({
          data: { data: [IN_RELEASE, UNSCHEDULED, OTHER_RELEASE] },
          error: undefined,
          response: { status: 200 },
        }))
      }
      return base(url, opts)
    })

    renderTab()
    await screen.findByText('Already in this release')
    expect(screen.getByRole('button', { name: 'Add Artifact' })).toBeDisabled()

    releaseItems(undefined)
    await openPicker()
    expect(screen.getByRole('checkbox', { name: 'US-1 · Already in this release' })).toBeChecked()
  })
})
