/**
 * WID-T06 — "Collapse/summary behavior", and its acceptance criterion:
 *
 *   AC 7: "Collapse icon returns user to summary panel state WITHOUT LOSING SELECTED ITEM."
 *
 * The load-bearing assertion is the second clause. A collapse that navigates away and drops the
 * selection satisfies "returns user to the Backlog" and fails the AC, so every test here checks
 * the item is STILL SELECTED afterwards — the summary panel renders it by key.
 *
 * The harness mirrors the two routes rather than mocking the wiring: `/item/$itemKey` renders
 * `DetailLayout` with the real `useCollapseToSummary` handler, `/backlog` renders the real
 * `WorkItemSummaryPanel` from the real store. Only the router's `useNavigate` and the HTTP client
 * are stubbed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { DetailLayout } from '@/shared/ui/detail/detail-layout'
import { useCollapseToSummary, useSummarySelection } from '@/features/work-items/summary-selection'
import { WorkItemSummaryPanel } from './work-item-summary-panel'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const ITEM = {
  id: 'wi-1',
  projectId: 'p1',
  itemKey: 'US-3',
  type: 'story',
  title: 'Bulk edit from the grid',
  description: '<p>Planners edit many rows at once.</p>',
  scheduleState: 'in_progress',
  priority: 'none',
  assigneeId: 'u1',
  storyPoints: 5,
  releaseId: 'rel-1',
  iterationId: 'it-1',
}

/** Route-shaped harness: the detail page collapses, the Backlog shows the summary panel. */
function Harness({ itemKey = 'US-3' }: { itemKey?: string } = {}) {
  const collapse = useCollapseToSummary(itemKey)
  const selectedKey = useSummarySelection((s) => s.itemKey)
  const clear = useSummarySelection((s) => s.clear)

  // `/backlog` — the collapsed state.
  if (selectedKey) {
    return (
      <WorkItemSummaryPanel
        itemKey={selectedKey}
        projectId="p1"
        onClose={clear}
        onExpand={vi.fn()}
      />
    )
  }

  // `/item/$itemKey` — the expanded state.
  return (
    <DetailLayout
      onBack={vi.fn()}
      onCollapse={collapse}
      collapseLabel="Collapse to summary panel"
      title="Bulk edit from the grid"
      itemKey={itemKey}
      tabs={[{ key: 'details', label: 'Details' }]}
      activeTab="details"
      onTabChange={vi.fn()}
    >
      <div>panel body</div>
    </DetailLayout>
  )
}

function renderHarness(props?: { itemKey?: string }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useSummarySelection.setState({ itemKey: null })
  navigate.mockReset()
  mockGET.mockReset()
  mockGET.mockImplementation((path: string) => {
    if (path === '/v1/work-items/by-key') {
      return Promise.resolve({ data: ITEM, error: undefined, response: { status: 200 } })
    }
    // `/v1/releases/options`, NOT `/v1/releases`: the summary panel resolves a release NAME, so it
    // reads the REFERENCE feed (`project:view`). The administrative list is `release:view`, which a
    // project Editor does not hold — and this panel would render `--` for a real release.
    // A bare array, not `{ data }`: the options feed is unpaged, because a picker offering a page of
    // a project's releases is the defect it exists to fix.
    if (path === '/v1/releases/options') {
      return Promise.resolve({
        data: [{ id: 'rel-1', name: 'R1' }],
        error: undefined,
        response: { status: 200 },
      })
    }
    if (path === '/v1/iterations') {
      return Promise.resolve({
        data: { data: [{ id: 'it-1', name: 'Sprint 26.1' }] },
        error: undefined,
        response: { status: 200 },
      })
    }
    if (path === '/v1/projects/{id}/members') {
      return Promise.resolve({
        data: [{ userId: 'u1', displayName: 'Marcus Webb' }],
        error: undefined,
        response: { status: 200 },
      })
    }
    return Promise.resolve({ data: undefined, error: undefined, response: { status: 200 } })
  })
})

describe('WID-T06 collapse/summary behaviour', () => {
  it('AC 7: collapsing returns to the Backlog with the item STILL SELECTED', async () => {
    renderHarness()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse to summary panel' }))

    // Half one — returned to the Backlog.
    expect(navigate).toHaveBeenCalledWith({ to: '/backlog' })

    // Half two, the one AC 7 is about — the item is not lost. It is still the selection, and the
    // summary panel is showing it.
    expect(useSummarySelection.getState().itemKey).toBe('US-3')
    expect(await screen.findByRole('complementary', { name: 'Work item summary' })).toBeVisible()
    await waitFor(() => expect(screen.getByText('US-3')).toBeVisible())
    expect(screen.getByText('Bulk edit from the grid')).toBeVisible()
  })

  it('the collapse control is a real button with an accessible name (keyboard reachable)', () => {
    renderHarness()

    const control = screen.getByRole('button', { name: 'Collapse to summary panel' })
    // A native <button> activates on Enter and Space and takes focus without a tabindex —
    // the two defects this repo already fixed on SortHeader and DragHandle.
    expect(control.tagName).toBe('BUTTON')
    control.focus()
    expect(control).toHaveFocus()
  })

  it('renders no collapse control when a detail surface does not pass onCollapse', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <DetailLayout
          onBack={vi.fn()}
          title="No summary panel here"
          tabs={[{ key: 'details', label: 'Details' }]}
          activeTab="details"
          onTabChange={vi.fn()}
        >
          <div>body</div>
        </DetailLayout>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Collapse to summary panel' })).toBeNull()
  })

  it('the summary panel shows the resolved item, and closing it drops the selection', async () => {
    useSummarySelection.setState({ itemKey: 'US-3' })
    renderHarness()

    await waitFor(() => expect(screen.getByText('Marcus Webb')).toBeVisible())
    expect(screen.getByText('Sprint 26.1')).toBeVisible()
    expect(screen.getByText('R1')).toBeVisible()
    expect(screen.getByText('Planners edit many rows at once.')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Close summary panel' }))
    expect(useSummarySelection.getState().itemKey).toBeNull()
  })

  it('does not summarise an item belonging to another project', async () => {
    mockGET.mockImplementation((path: string) =>
      path === '/v1/work-items/by-key'
        ? Promise.resolve({
            data: { ...ITEM, projectId: 'other-project' },
            error: undefined,
            response: { status: 200 },
          })
        : Promise.resolve({ data: undefined, error: undefined, response: { status: 200 } }),
    )
    useSummarySelection.setState({ itemKey: 'US-3' })
    renderHarness()

    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Work item summary' })).toBeNull(),
    )
  })
})
