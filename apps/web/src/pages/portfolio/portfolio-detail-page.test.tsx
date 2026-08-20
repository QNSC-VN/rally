/**
 * `Add Item` on a Feature's Children tab — BOTH buttons, one completion path (P5-PI-016).
 *
 * `Create with details` was a dead control. The modal renders it unconditionally and calls
 * `onCreatedWithDetails?.(item)`, and this page passed only `onCreated` — so pressing it created a
 * Story and then did nothing at all: no close, no navigation, no toast. Worse, the FEATURE LINK
 * lived inside `onCreated` (`featureId` is not on `CreateWorkItemSchema`, so it is a second PATCH),
 * which the with-details path never reached: the one item it did create was left UNLINKED, in the
 * backlog, invisible on the tab that created it.
 *
 * So the assertions here are about the page's wiring, and each one fails against that code:
 *   • the modal receives BOTH callbacks;
 *   • exactly ONE work item is created and exactly ONE link PATCH follows it, on either button;
 *   • the link carries this Feature's id — the prefill the BA asks to survive;
 *   • `Create with details` navigates to `/item/$itemKey` for THAT item, and only after the link
 *     has landed (the detail page re-reads the row, so navigating first shows an empty Feature).
 *
 * The create modal itself is stubbed — it is another surface's component and is under concurrent
 * edit — but the stub creates through the REAL `useCreateWorkItem` hook, so the create and the link
 * are both counted at the HTTP layer rather than being taken on trust.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ itemId: 'fe-1' }),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))

// This suite does not exercise back navigation; the hook needs the real router (`useRouter` /
// `useCanGoBack`), which the mock above deliberately does not provide. Its own behaviour is covered
// by `shared/lib/use-detail-back.test.tsx`.
vi.mock('@/shared/lib/use-detail-back', () => ({ useDetailBack: () => vi.fn() }))

// `t(key, options)` — the second argument is an interpolation bag on this page, never a fallback
// string, so returning it would render an object.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => (typeof options === 'string' ? options : key),
  }),
}))

// `vi.hoisted`, because the factory below runs before this file's own top-level statements.
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/lib/toast', () => ({
  notify: toasts,
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : 'failed'),
}))

vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: () => true, permissions: [], isLoading: false }),
}))

// Expensive or irrelevant bodies. Everything asserted below lives in the page's own callbacks.
vi.mock('@/shared/ui/rich-text-editor', () => ({
  RichTextEditor: ({ title }: { title: string }) => <div>{title}</div>,
}))
vi.mock('@/features/collaboration/ui/attachment-block', () => ({ AttachmentBlock: () => <div /> }))
vi.mock('@/features/collaboration/ui/comment-thread', () => ({ CommentThread: () => <div /> }))
vi.mock('@/features/collaboration/use-upload-pasted-images', () => ({
  useUploadPastedImages: () => ({ uploadAndRewrite: async (html: string) => html }),
}))
vi.mock('@/entities/activity/ui/activity-history-tab', () => ({
  ActivityHistoryTab: () => <div />,
}))
vi.mock('./ui/detail-sidebar', () => ({ PortfolioDetailSidebar: () => <div /> }))

/** The Children tab, reduced to the one control this test presses. */
vi.mock('./ui/feature-children-table', () => ({
  FeatureChildrenTable: ({ onAddItem }: { onAddItem?: () => void }) =>
    onAddItem ? <button onClick={onAddItem}>Add Item</button> : <div>read only</div>,
}))

/**
 * The create modal, stubbed — but creating through the real mutation.
 *
 * Both buttons run the same POST the real modal runs, so "exactly one item was created" is a
 * statement about requests, not about this stub. `with-details wired` renders the defect itself:
 * against the old page that node read `no`.
 */
vi.mock('@/features/work-items/ui/create-work-item-modal', async () => {
  const { useCreateWorkItem } = await import('@/features/work-items/api')
  return {
    CreateWorkItemModal: ({
      projectId,
      onCreated,
      onCreatedWithDetails,
    }: {
      projectId: string
      onCreated?: (item: { id: string; itemKey: string }) => void
      onCreatedWithDetails?: (item: { id: string; itemKey: string }) => void
    }) => {
      const create = useCreateWorkItem()
      async function submit(withDetails: boolean) {
        const item = await create.mutateAsync({
          projectId,
          type: 'story',
          title: 'Retry a failed payment',
          priority: 'none',
        })
        if (withDetails) onCreatedWithDetails?.(item)
        else onCreated?.(item)
      }
      return (
        <div>
          <span>{`with-details wired: ${onCreatedWithDetails ? 'yes' : 'no'}`}</span>
          <button onClick={() => void submit(false)}>stub create</button>
          <button onClick={() => void submit(true)}>stub create with details</button>
        </div>
      )
    },
  }
})

import { apiClient } from '@/shared/api/http-client'
import { PortfolioDetailPage } from './portfolio-detail-page'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

const FEATURE = {
  id: 'fe-1',
  workspaceId: 'ws-1',
  projectId: 'p-nxp',
  itemKey: 'FE-1',
  type: 'feature',
  name: 'Payment retries',
  description: null,
  notes: null,
  releaseNotes: null,
  whatSuccessLooksLike: null,
  state: 'no_entry',
  preliminaryEstimate: 'no_entry',
  refinedEstimate: '0',
  refinedItemCountEstimate: 0,
  parentId: null,
  teamId: null,
  releaseId: null,
  ownerId: null,
  plannedStartDate: null,
  plannedEndDate: null,
  marketReleaseDate: null,
  rank: 'a',
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  childFeatureCount: 0,
  milestones: [],
  acceptedChildren: {
    total: { points: 0, count: 0, acceptedPoints: 0, acceptedCount: 0 },
    byType: [],
  },
}

const CREATED = { id: 'wi-9', itemKey: 'US-42', projectId: 'p-nxp', type: 'story' }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

/** Open the Children tab and press `Add Item`, leaving the stub modal on screen. */
async function openCreateModal() {
  const user = userEvent.setup()
  render(<PortfolioDetailPage />, { wrapper: wrapper() })
  await waitFor(() => expect(screen.getByText('FE-1')).toBeInTheDocument())
  await user.click(screen.getByRole('tab', { name: /detail\.tabs\.children/ }))
  await user.click(screen.getByRole('button', { name: 'Add Item' }))
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGET.mockImplementation((path: string) => {
    if (path === '/v1/portfolio-items/{id}')
      return Promise.resolve({ data: FEATURE, error: undefined, response: { status: 200 } })
    if (path === '/v1/portfolio-items/{id}/children')
      return Promise.resolve({
        data: { data: [], pageInfo: { nextCursor: null, hasNextPage: false, limit: 100 } },
        error: undefined,
        response: { status: 200 },
      })
    // Everything else the page reads: the epic list, member/release/milestone options, activity.
    // A bare array — those feeds are unpaged, and every paged reader here falls back to `[]`.
    return Promise.resolve({ data: [], error: undefined, response: { status: 200 } })
  })
  mockPOST.mockResolvedValue({ data: CREATED, error: undefined, response: { status: 201 } })
  mockPATCH.mockResolvedValue({
    data: { ...CREATED, featureId: 'fe-1' },
    error: undefined,
    response: { status: 200 },
  })
})

describe('Feature Children tab — Add Item', () => {
  it('gives the modal BOTH completion callbacks', async () => {
    await openCreateModal()

    expect(screen.getByText('with-details wired: yes')).toBeInTheDocument()
  })

  /**
   * P5-PI-FR-013 / P5-PI-003: `Add Item` inherits the FEATURE's Project, and the reused modal has
   * no way to change it.
   *
   * The stub above receives `projectId` and posts with it, which is the half this page owns — the
   * absence of a picker inside the modal is pinned by
   * `features/work-items/ui/create-work-item-modal.test.tsx`. Both halves matter: the page could
   * pass the right project into a modal that then offered to move it, which is exactly the state
   * the BA reproduced.
   */
  it("creates the child in the FEATURE's project", async () => {
    const user = await openCreateModal()

    await user.click(screen.getByRole('button', { name: 'stub create' }))

    await waitFor(() => expect(mockPOST).toHaveBeenCalledTimes(1))
    expect(mockPOST.mock.calls[0][1].body.projectId).toBe(FEATURE.projectId)
  })

  it('Create with details creates ONE item, links it to this Feature, then opens it', async () => {
    const user = await openCreateModal()

    await user.click(screen.getByRole('button', { name: 'stub create with details' }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    // Exactly one of each: one Story, linked once. The old shape linked on one path only.
    expect(mockPOST).toHaveBeenCalledTimes(1)
    expect(mockPATCH).toHaveBeenCalledTimes(1)
    expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/{id}', {
      params: { path: { id: 'wi-9' } },
      body: { featureId: 'fe-1' },
    })
    expect(navigate).toHaveBeenCalledWith({
      to: '/item/$itemKey',
      params: { itemKey: 'US-42' },
    })
  })

  it('links BEFORE it navigates, so the detail page reads the Feature it was given', async () => {
    let resolveLink: (v: unknown) => void = () => {}
    mockPATCH.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLink = resolve
        }),
    )
    const user = await openCreateModal()

    await user.click(screen.getByRole('button', { name: 'stub create with details' }))

    // The link is in flight: navigating here is what leaves the reader on an empty Feature field.
    await waitFor(() => expect(mockPATCH).toHaveBeenCalledTimes(1))
    expect(navigate).not.toHaveBeenCalled()

    resolveLink({ data: CREATED, error: undefined, response: { status: 200 } })
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
  })

  it('plain Create links the same way and stays on the tab', async () => {
    const user = await openCreateModal()

    await user.click(screen.getByRole('button', { name: 'stub create' }))

    await waitFor(() => expect(toasts.success).toHaveBeenCalled())
    expect(mockPOST).toHaveBeenCalledTimes(1)
    expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/{id}', {
      params: { path: { id: 'wi-9' } },
      body: { featureId: 'fe-1' },
    })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('reports a failed link and still opens the item it created', async () => {
    mockPATCH.mockResolvedValue({
      data: undefined,
      error: {
        error: { code: 'WORK_ITEM_FEATURE_LINK_ARCHIVED', message: 'That Feature is archived' },
      },
      response: { status: 412 },
    })
    const user = await openCreateModal()

    await user.click(screen.getByRole('button', { name: 'stub create with details' }))

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('That Feature is archived'))
    // The Story exists either way; the detail page is where the reader can set the Feature by hand.
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(toasts.success).not.toHaveBeenCalled()
  })
})
