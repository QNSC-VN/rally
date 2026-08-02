import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

// The Feature's project scopes these two option lists; the rows under test do not depend on their
// contents, only on the cells being wired to them.
vi.mock('@/features/releases/api', () => ({
  useReleases: () => ({ data: [{ id: 'r1', name: 'v2.0', releaseKey: 'REL-1' }] }),
}))
vi.mock('@/features/teams/api', () => ({
  useProjectMembers: () => ({
    data: [{ userId: 'u1', displayName: 'Admin User', email: 'admin@qnsc.dev' }],
  }),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { FeatureChildrenTable } from './feature-children-table'
import type { PortfolioChild } from '@/features/portfolio/api'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

/** Renders with a QueryClient — the row's inline edits and task disclosure both go through it. */
function renderTable(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

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
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" />)
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
    // The fixture is a STORY, so its Priority cell is `--`: §5.2 scopes that column to Defects, and
    // the previous read-only tab printed a Story's stored priority regardless — a value the product
    // does not consider it to have. The Defect case is covered below.
    expect(screen.getByText('--')).toBeTruthy()
    expect(screen.getByText('Sprint 26.1')).toBeTruthy()
  })

  it('foots the Est column, which is the one total the BA asks for', () => {
    renderTable(
      <FeatureChildrenTable
        children={[child(), child({ id: 'c2', itemKey: 'US-2', storyPoints: 3 })]}
        projectId="p1"
      />,
    )
    expect(screen.getByText('Totals (2)')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })

  it('shows a DASH for an unestimated child rather than zero', () => {
    // A Story nobody has sized is not a Story worth zero points, and the total must not pretend it is.
    renderTable(<FeatureChildrenTable children={[child({ storyPoints: null })]} projectId="p1" />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('Totals (1)')).toBeTruthy()
  })

  it('narrows on search, and the TOTAL follows the visible rows', () => {
    // A total that ignored the search would disagree with the rows above it, and nothing on screen
    // would say which set it described.
    renderTable(
      <FeatureChildrenTable
        children={[
          child(),
          child({ id: 'c2', itemKey: 'DE-9', title: 'Flaky pipeline', storyPoints: 13 }),
        ]}
        projectId="p1"
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
    const { unmount } = renderTable(<FeatureChildrenTable children={[]} projectId="p1" />)
    expect(screen.getByText('Nothing linked yet.')).toBeTruthy()
    unmount()

    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search linked items' }), {
      target: { value: 'zzzz' },
    })
    expect(screen.getByText('No linked item matches that search.')).toBeTruthy()
  })

  // ── FR-011: inline edit ────────────────────────────────────────────────────

  it('commits a Name edit to the work item (FR-011)', async () => {
    mockPATCH.mockResolvedValue({ data: {}, error: undefined, response: { status: 200 } })
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" canEdit />)

    fireEvent.click(screen.getByText('Upgrade the workspace'))
    const input = await screen.findByRole('textbox', { name: 'US-1 name' })
    fireEvent.change(input, { target: { value: 'Renamed from the Children tab' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/{id}', {
        params: { path: { id: 'c1' } },
        body: { title: 'Renamed from the Children tab' },
      }),
    )
  })

  it('offers Priority on a Defect and never on a Story (FR-011, §5.2)', () => {
    const { unmount } = renderTable(
      <FeatureChildrenTable children={[child({ type: 'defect' })]} projectId="p1" canEdit />,
    )
    expect(screen.getByRole('button', { name: 'US-1 priority' })).toBeTruthy()
    unmount()

    // A Story has no Priority in this product, so the cell is a dash rather than a disabled control.
    renderTable(
      <FeatureChildrenTable children={[child({ type: 'story' })]} projectId="p1" canEdit />,
    )
    expect(screen.queryByRole('button', { name: 'US-1 priority' })).toBeNull()
  })

  it('does not edit without portfolio:edit — FR-011 gates on it', async () => {
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" canEdit={false} />)

    fireEvent.click(screen.getByText('Upgrade the workspace'))
    // Read-only: the click opens no editor, so no PATCH can follow.
    expect(screen.queryByRole('textbox', { name: 'US-1 name' })).toBeNull()
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('leaves Iteration read-only, which §5.2 calls a deliberate trim', () => {
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" canEdit />)

    fireEvent.click(screen.getByText('Sprint 26.1'))
    expect(screen.queryByRole('textbox', { name: /iteration/i })).toBeNull()
    expect(screen.getByText('Sprint 26.1')).toBeTruthy()
  })

  // ── FR-012: expand to Tasks, read-only ─────────────────────────────────────

  it('discloses a child’s Tasks read-only, fetched only once expanded (FR-012)', async () => {
    mockGET.mockResolvedValue({
      data: [
        {
          id: 'tk1',
          itemKey: 'TA-1',
          title: 'Write the migration',
          scheduleState: 'in_progress',
          estimateHours: 8,
          todoHours: 3,
          actualHours: 5,
          assigneeId: 'u1',
        },
      ],
      error: undefined,
      response: { status: 200 },
    })
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" canEdit />)

    // Nothing is fetched for a collapsed row — a Feature can link many children, and loading every
    // task list to render none would be the expensive default.
    expect(mockGET).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Show tasks for US-1' }))

    const task = await screen.findByText('Write the migration')
    expect(mockGET).toHaveBeenCalledWith('/v1/work-items/{id}/tasks', {
      params: { path: { id: 'c1' } },
    })
    expect(screen.getByText('TA-1')).toBeTruthy()
    expect(screen.getByText('To Do 3h · Actual 5h')).toBeTruthy()
    // Read-only per §5.2: the disclosed rows carry no editable control.
    const row = task.closest<HTMLElement>('div.flex')!
    expect(within(row).queryByRole('textbox')).toBeNull()
  })

  it('says so when a disclosed child has no Tasks', async () => {
    mockGET.mockResolvedValue({ data: [], error: undefined, response: { status: 200 } })
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Show tasks for US-1' }))

    expect(await screen.findByText('No tasks on this item.')).toBeTruthy()
  })
})
