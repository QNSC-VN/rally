/**
 * Home's KPI strip — an ABSENT number, never a measured `0`.
 *
 * GAP-P4-RBAC-003 AC4. The strip is the first screen after login and six large numbers is the whole
 * of it, so `summary?.openWorkItems ?? 0` turns a refused or failed request into the sentence "this
 * workspace holds nothing" — a fabricated fact, and exactly the class CLAUDE.md records for Release
 * Tracking's three zeros and Team Capacity's four `0h` cards. `EMPTY_VALUE` (`--`) is this app's only
 * placeholder for a value that is not known.
 *
 * The structure-preserving rule is asserted alongside it: the six tiles stay MOUNTED through loading,
 * error and ready, which is precisely why their values cannot be coerced — a caller that unmounts the
 * strip on failure never has to decide what to print, and this one cannot take that way out. The
 * error phase additionally has to SAY so, because six silent `--` is indistinguishable from a
 * workspace that genuinely holds nothing.
 *
 * What the numbers COUNT is a server concern and is fixed there: `GET /v1/work-items/summary` is now
 * scoped by `AccessService.listReadableProjectIds`, so a project whose access was removed contributes
 * to none of them. This spec pins the rendering half — that a scope with nothing in it, and a request
 * that failed, cannot look the same.
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_VALUE } from '@/shared/lib/utils'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/shared/lib/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { displayName: 'Ada Lovelace' } }),
}))

vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({
    workspace: { workspaceId: 'ws-1', workspaceName: 'QNSC' },
    project: null,
  }),
}))

/** The summary query's state, swapped per test. */
const summary: {
  data: Record<string, number> | undefined
  isLoading: boolean
  isError: boolean
  error?: unknown
} = { data: undefined, isLoading: false, isError: false }

/** The Project Health rows, swapped per test. */
const health: { data: unknown[]; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
}

vi.mock('@/features/home/api', () => ({
  useWorkspaceSummary: () => summary,
  useMyWork: () => ({ data: [], isLoading: false, isError: false }),
  useProjectHealth: () => health,
}))

vi.mock('@/features/notifications/api', () => ({
  useNotifications: () => ({ data: [], isLoading: false, isError: false }),
}))

vi.mock('@/features/notifications/use-open-notification', () => ({
  useOpenNotification: () => vi.fn(),
}))

const { HomePage } = await import('./home-page')

/**
 * The six tile VALUES. i18n is not initialised under test so the labels render as raw keys; the
 * values are the numeric/`--` nodes, which is what this spec is about.
 */
function tileValues(container: HTMLElement): string[] {
  return [...container.querySelectorAll('span.text-xl')].map((n) => n.textContent ?? '')
}

beforeEach(() => {
  summary.data = undefined
  summary.isLoading = false
  summary.isError = false
  summary.error = undefined
  health.data = []
  health.isLoading = false
  health.isError = false
})

describe('Home KPI strip', () => {
  it('renders `--` for every tile when the summary FAILED — never 0', () => {
    summary.isError = true
    summary.error = new Error('boom')
    const { container } = render(<HomePage />)

    const values = tileValues(container)
    expect(values).toHaveLength(6)
    expect(values).toEqual(Array(6).fill(EMPTY_VALUE))
    expect(values).not.toContain('0')
  })

  it('SAYS the summary failed — six silent `--` would read as an empty workspace', () => {
    summary.isError = true
    summary.error = new Error('boom')
    render(<HomePage />)
    // `role="alert"` because it replaces the meaning of a region the reader is already looking at.
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('keeps the six tiles MOUNTED on failure — the structure-preserving rule', () => {
    summary.isError = true
    const { container } = render(<HomePage />)
    expect(tileValues(container)).toHaveLength(6)
  })

  it('renders a measured 0 only when the server actually answered 0', () => {
    // A reader with no readable project legitimately has nothing in scope, and `0` is the honest
    // report of that. The point of the two tests above is that a FAILURE must not borrow this claim.
    summary.data = {
      activeProjects: 0,
      openWorkItems: 0,
      activeSprints: 0,
      blockedItems: 0,
      openDefects: 0,
      assignedToMe: 0,
    }
    const { container } = render(<HomePage />)
    expect(tileValues(container)).toEqual(Array(6).fill('0'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the counts when the summary resolves', () => {
    summary.data = {
      activeProjects: 2,
      openWorkItems: 41,
      activeSprints: 1,
      blockedItems: 3,
      openDefects: 7,
      assignedToMe: 5,
    }
    const { container } = render(<HomePage />)
    expect(tileValues(container)).toEqual(['2', '41', '1', '3', '7', '5'])
  })
})

/**
 * The two panel tables, after the migration off their hand-rolled chrome.
 *
 * They were the same shape written twice, and shared one defect: `flex-1` with no `min-w-0` on the
 * Name column, so a long project name could not shrink below its own content and squeezed the fixed
 * columns until every remaining HEADING wrapped — `Open Defects` breaking across two lines while the
 * body rows kept their height. `PanelTable` states each width once and applies it to the heading and
 * the cell through one component, so the two can no longer disagree.
 */
describe('Home panel tables', () => {
  const ROW = {
    id: 'p-1',
    key: 'MINIRAL',
    name: 'A deliberately long project name that used to squeeze its neighbours',
    activeSprintName: null,
    progressPercent: 0,
    openDefects: 11,
    blockedCount: 0,
    leadName: 'Hieu Vu Minh Bui',
  }

  it('gives the flexible Name column `min-width: 0` so headings cannot be squeezed', () => {
    health.data = [ROW]
    const { container } = render(<HomePage />)

    // Both tables' flexible column. Without this the fixed columns lose their width and their
    // headings wrap — the reported defect, and the only thing that actually caused it.
    const flexible = [...container.querySelectorAll<HTMLElement>('[style*="min-width"]')].filter(
      (n) => n.style.minWidth === '0px' && n.style.flex.startsWith('1'),
    )
    expect(flexible.length).toBeGreaterThan(0)
  })

  it('keeps every OTHER column at its declared width and unshrinkable', () => {
    health.data = [ROW]
    const { container } = render(<HomePage />)

    const fixed = [...container.querySelectorAll<HTMLElement>('[style*="flex-shrink"]')].filter(
      (n) => n.style.flexShrink === '0' && n.style.width,
    )
    // A fixed column that can shrink is a heading that can wrap.
    expect(fixed.length).toBeGreaterThan(0)
    for (const cell of fixed) expect(cell.style.width).toMatch(/^\d+px$/)
  })

  it('still renders the row, and still marks the SELECTED project', () => {
    // The control for the two assertions above: geometry that renders no data is not a table.
    health.data = [ROW]
    render(<HomePage />)
    expect(screen.getByText(ROW.name)).toBeTruthy()
    expect(screen.getByText('MINIRAL')).toBeTruthy()
    expect(screen.getByText('Hieu Vu Minh Bui')).toBeTruthy()
  })
})
