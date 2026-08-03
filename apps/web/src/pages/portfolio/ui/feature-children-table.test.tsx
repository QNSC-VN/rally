import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

// The Feature's project scopes these two option lists. The fixtures are partial on purpose — the
// cells read only these fields — but they are cast through the real types, so a rename in `Release`
// or `ProjectMember` fails here rather than silently leaving the mock describing a shape the
// component no longer receives.
vi.mock('@/features/releases/api', () => ({
  useReleases: () => ({
    data: [{ id: 'r1', name: 'v2.0', releaseKey: 'REL-1' } as unknown as Release],
  }),
}))
vi.mock('@/features/teams/api', () => ({
  useProjectMembers: () => ({
    data: [
      {
        userId: 'u1',
        displayName: 'Admin User',
        email: 'admin@qnsc.dev',
      } as unknown as ProjectMember,
    ],
  }),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { FeatureChildrenTable } from './feature-children-table'
import type { PortfolioChild } from '@/features/portfolio/api'
import type { Release } from '@/features/releases/api'
import type { ProjectMember } from '@/features/teams/api'
import { PRIORITY_LABEL, PRIORITY_VALUES } from '@/entities/work-item/model/types'
import { PORTFOLIO_CHILD_COLUMNS } from '../model/children-columns'

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
    //
    // `Type` is deliberately NOT among them: the ID cell renders the type badge, so a Type column
    // showed the same field twice in adjacent cells. Backlog and Iteration Status both carry type
    // through the ID cell alone.
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" />)
    // Not `queryByText('Type')` — the collapsed filter panel has a Type control with that label.
    // The assertion is about the COLUMN, so it reads the column spec the grid was built from.
    expect(PORTFOLIO_CHILD_COLUMNS.map((c) => c.key)).not.toContain('type')
    for (const heading of [
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

  it('has NO totals row — the grid it is modelled on has none', () => {
    // Iteration Status foots nothing, and the one number this footed (summed Plan Estimate) is a
    // roll-up the Feature's own Details tab already reports through its progress bars.
    renderTable(
      <FeatureChildrenTable
        children={[child(), child({ id: 'c2', itemKey: 'US-2', storyPoints: 3 })]}
        projectId="p1"
      />,
    )
    expect(screen.queryByText(/^Totals/)).toBeNull()
    // The per-row estimates are still shown; only the footer is gone.
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('shows a DASH for an unestimated child rather than zero', () => {
    // A Story nobody has sized is not a Story worth zero points.
    renderTable(<FeatureChildrenTable children={[child({ storyPoints: null })]} projectId="p1" />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('narrows on search', () => {
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
    expect(screen.getByText('Flaky pipeline')).toBeTruthy()
    // The surviving row keeps its own estimate; the filtered-out 5-point row is gone entirely.
    expect(screen.getByText('13')).toBeTruthy()
    expect(screen.queryByText('5')).toBeNull()
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

  it('offers exactly the shared priority enum, not a locally-written list', async () => {
    // This cell first shipped with a hand-written `['none','low','normal','high','urgent']`. It
    // happened to match, but it was a second copy of `work_item_priority` to keep in step — and the
    // `work-items:priority.*` i18n block it drew labels from still carries a `critical` key that
    // migration 0011 remapped to `urgent`, so a label-driven list would have offered a dead value.
    renderTable(
      <FeatureChildrenTable children={[child({ type: 'defect' })]} projectId="p1" canEdit />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'US-1 priority' }))

    // The popover renders each option as a plain button, so assert on the labels themselves.
    const popover = await screen.findByRole('dialog')
    for (const label of PRIORITY_VALUES.map((p) => PRIORITY_LABEL[p])) {
      expect(within(popover).getByText(label)).toBeTruthy()
    }
    expect(within(popover).queryByText('Critical')).toBeNull()
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

  // ── Toolbar + drag ─────────────────────────────────────────────────────────

  it('renders the shared toolbar: search, Add New, Filters and Show Fields', () => {
    const onAddItem = vi.fn()
    renderTable(
      <FeatureChildrenTable children={[child()]} projectId="p1" canEdit onAddItem={onAddItem} />,
    )

    expect(screen.getByRole('searchbox', { name: 'Search linked items' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filters/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Show Fields/i })).toBeTruthy()

    // Add New must actually DO something — it first shipped permanently disabled.
    fireEvent.click(screen.getByRole('button', { name: /Add New/i }))
    expect(onAddItem).toHaveBeenCalled()
  })

  it('hides Add New when there is no creation flow or no edit right', () => {
    const { unmount } = renderTable(
      <FeatureChildrenTable children={[child()]} projectId="p1" canEdit />,
    )
    expect(screen.queryByRole('button', { name: /Add New/i })).toBeNull()
    unmount()

    renderTable(
      <FeatureChildrenTable
        children={[child()]}
        projectId="p1"
        canEdit={false}
        onAddItem={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /Add New/i })).toBeNull()
  })

  it('gives each row a drag grip, and takes it away when the order is not rank', async () => {
    // The rows arrive ordered by `workItems.rank` and the work-item rank endpoint can rewrite it,
    // so the list was always reorderable — it simply had no grip.
    const { unmount } = renderTable(
      <FeatureChildrenTable children={[child()]} projectId="p1" canEdit />,
    )
    expect(screen.getByRole('button', { name: /drag/i })).toBeTruthy()
    unmount()

    // Read-only: no grip, because there is nothing this reader may persist.
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" canEdit={false} />)
    expect(screen.queryByRole('button', { name: /drag/i })).toBeNull()
  })

  it('disables the grip while a filter reorders the list away from rank', async () => {
    renderTable(
      <FeatureChildrenTable
        children={[child(), child({ id: 'c2', itemKey: 'DE-9', type: 'defect' })]}
        projectId="p1"
        canEdit
      />,
    )
    expect(screen.getAllByRole('button', { name: /drag/i }).length).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: /Filters/i }))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'defect' } })

    // A filtered list is no longer rank order, so a drop would compute neighbours the server
    // does not share.
    await waitFor(() => expect(screen.queryByRole('button', { name: /drag/i })).toBeNull())
  })

  // ── FR-012: expand to Tasks, read-only ─────────────────────────────────────

  it('discloses a child’s Tasks, fetched only once expanded (FR-012)', async () => {
    mockGET.mockResolvedValue({
      data: [
        {
          id: 'tk1',
          itemKey: 'TA-1',
          type: 'task',
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

    const subRow = task.closest<HTMLElement>('div.flex')!
    // One cell per column, in the parent's order — the sub-row first shipped borrowing keys, with
    // Task state drawn in the `priority` column and the hours in `scheduleState`, so values sat
    // under headings that named something else and a column resize moved them somewhere new.
    // Every column contributes a cell carrying that column's CSS `order`. (`name` flexes rather
    // than taking a fixed width, which is why this reads `order` and not `width`.)
    const ordered = [...subRow.children].filter((el) => (el as HTMLElement).style.order !== '')
    expect(ordered).toHaveLength(PORTFOLIO_CHILD_COLUMNS.length)

    // The three hour fields each get their OWN column, as they do on Iteration Status. They were
    // packed into one `To Do 3h · Actual 5h` string in a column that named neither.
    expect(screen.queryByText(/To Do 3h · Actual 5h/)).toBeNull()
    for (const hours of ['8', '3', '5']) {
      expect(within(subRow).getByText(hours)).toBeTruthy()
    }

    // Owner and State are the SHARED editable controls, not the flat text this row used to show.
    expect(within(subRow).getByLabelText('TA-1 owner')).toBeTruthy()
    expect(within(subRow).getByLabelText('TA-1 state')).toBeTruthy()
  })

  it('commits a Task hour edit from the disclosed row', async () => {
    mockGET.mockResolvedValue({
      data: [
        {
          id: 'tk1',
          itemKey: 'TA-1',
          type: 'task',
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
    mockPATCH.mockResolvedValue({ data: {}, error: undefined, response: { status: 200 } })
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" canEdit />)

    fireEvent.click(screen.getByRole('button', { name: 'Show tasks for US-1' }))
    // `3` is the To Do value; clicking the cell opens its editor (the resting cell is plain text,
    // so the accessible name only exists once editing starts).
    const todo = await screen.findByText('3')
    fireEvent.click(todo)

    const input = await screen.findByRole('textbox', { name: 'TA-1 to do hours' })
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.blur(input)

    // Estimate / To Do / Actual are three INDEPENDENT fields — editing one writes only that one.
    await waitFor(() =>
      expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/{id}', {
        params: { path: { id: 'tk1' } },
        body: { todoHours: 2 },
      }),
    )
  })

  it('gives the PARENT row a cell per column too, or the two rows fall out of step', async () => {
    // The regression this pins: `Task Est` / `To Do` / `Actual` were added to the header and to the
    // disclosed Task rows, but not to the Story/Defect row above them. The parent then rendered
    // three cells short, so every value after `Est` slid one column left — Owner appeared under
    // Est, the state stepper under Owner — and the grid read as broken.
    mockGET.mockResolvedValue({
      data: [
        {
          id: 'tk1',
          itemKey: 'TA-1',
          type: 'task',
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

    const cellCount = (row: HTMLElement) =>
      [...row.children].filter((el) => (el as HTMLElement).style.order !== '').length

    const parentRow = screen.getByText('Upgrade the workspace').closest<HTMLElement>('div.flex')!
    expect(cellCount(parentRow)).toBe(PORTFOLIO_CHILD_COLUMNS.length)

    fireEvent.click(screen.getByRole('button', { name: 'Show tasks for US-1' }))
    const subRow = (await screen.findByText('Write the migration')).closest<HTMLElement>(
      'div.flex',
    )!
    expect(cellCount(subRow)).toBe(PORTFOLIO_CHILD_COLUMNS.length)
  })

  it('WRAPS long ID and Name rather than clipping them, as every other grid does', () => {
    const longTitle =
      'Upgrade the NX workspace to v21 and migrate every generator, executor and preset'
    renderTable(
      <FeatureChildrenTable
        children={[child({ itemKey: 'US-100234', title: longTitle })]}
        projectId="p1"
      />,
    )

    // The row must be free to GROW: a fixed `h-*`, or `items-center` with no room, would cut the
    // second line off. `min-h` sets a floor, not a ceiling.
    const row = screen.getByText(longTitle).closest<HTMLElement>('div.flex')!
    expect(row.className).toContain('min-h-')
    // `(?<!min-)h-[` — a fixed height, as distinct from the `min-h-[..]` floor above.
    expect(row.className).not.toMatch(/(?<!min-)\bh-\[/)

    // And the text cells must not clip or ellipsize what wraps.
    for (const text of [longTitle, 'US-100234']) {
      const cell = screen.getByText(text)
      expect(cell.className).toContain('whitespace-normal')
      expect(cell.className).not.toContain('truncate')
    }

    // The Name cell needs a real CEILING, or the text has no edge to wrap against. A `grow`
    // column gets `minWidth: <width>` and no maxWidth — a floor it expands past — so paired with
    // the row's `min-w-max` the TABLE widened to fit a long title and nothing ever wrapped. That
    // is why `name` is a fixed-width column here, as it is on Iteration Status and the Backlog.
    const nameCell = screen.getByText(longTitle).parentElement!
    expect(nameCell.style.maxWidth).not.toBe('')
    expect(nameCell.style.width).not.toBe('')
  })

  it('keeps the Name editor inside its column when it opens', async () => {
    // A long Name opened an editor wider than its own column and spilled across the cells beside
    // it. Cause: a local `inputClassName` replaced the shared `FULL_CELL_INPUT`, dropping its
    // `w-full`. Iteration Status passes no override for exactly this reason.
    const longTitle = 'CI pipeline fails intermittently on Windows build agents'
    renderTable(
      <FeatureChildrenTable children={[child({ title: longTitle })]} projectId="p1" canEdit />,
    )

    fireEvent.click(screen.getByText(longTitle))
    const input = await screen.findByRole('textbox', { name: 'US-1 name' })
    expect(input.className).toContain('w-full')
  })

  it('says so when a disclosed child has no Tasks', async () => {
    mockGET.mockResolvedValue({ data: [], error: undefined, response: { status: 200 } })
    renderTable(<FeatureChildrenTable children={[child()]} projectId="p1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Show tasks for US-1' }))

    expect(await screen.findByText('No tasks on this item.')).toBeTruthy()
  })
})
