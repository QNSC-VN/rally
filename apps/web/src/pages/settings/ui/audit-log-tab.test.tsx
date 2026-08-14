import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * P45-04, Audit Log half: search must operate on the real set, not on the loaded page.
 *
 * The load-bearing test is the first one, and its shape is the point: the row it looks for is NOT
 * in the response for page one. A test that searched for something already on screen would pass
 * just as well against the old page-local box, which is exactly how this defect survived — the
 * seeded log is small enough that page one usually contains what you are looking for.
 *
 * What each test pins, and how it fails if reverted (all verified by doing it):
 *  1. Removing the Action select — or sending its value anywhere but the server query — loses the
 *     `project.deleted` row entirely, because the fake API only returns it for `?action=`.
 *  2. Dropping `pageInfo.total` from the footer takes "of 1284" with it, and with it the reader's
 *     only way to tell a filter that searched the log from one that searched a window.
 *  3. Restoring the old single "No audit events found." empty state makes a page-local miss
 *     indistinguishable from "this never happened" in the workspace.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: (selector: (s: unknown) => unknown) =>
    selector({ workspace: { workspaceId: 'ws-1' } }),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { AuditLogTab } from './audit-log-tab'

// Radix's popover measures its trigger; jsdom has no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const ADA = {
  userId: 'u-ada',
  displayName: 'Ada Admin',
  email: 'ada@acme.test',
}

/** One page of the log: 50 sign-ins, i.e. the newest 50 of 1,284 rows. */
const FIRST_PAGE = Array.from({ length: 50 }, (_, i) => ({
  id: `evt-${i}`,
  actorId: ADA.userId,
  actorName: ADA.displayName,
  actorEmail: ADA.email,
  action: 'auth.login.sso',
  resourceType: 'workspace',
  resourceId: 'ws-1',
  projectId: null,
  // No `authMethod`, so the describer renders the bare sentence rather than
  // "Signed in through SSO (Sso)" — this fixture is about paging, not wording.
  changes: {},
  metadata: {},
  occurredAt: '2026-08-14T09:00:00.000Z',
}))

/**
 * The row the test must find: it lives deep in the log, so it is served ONLY when the request
 * carries `action=project.deleted`. Nothing in `FIRST_PAGE` mentions "Legacy Portal".
 */
const DEEP_ROW = {
  id: 'evt-deep',
  actorId: ADA.userId,
  actorName: ADA.displayName,
  actorEmail: ADA.email,
  action: 'project.deleted',
  resourceType: 'project',
  resourceId: 'p-legacy',
  projectId: 'p-legacy',
  changes: { before: { name: 'Legacy Portal' } },
  metadata: {},
  occurredAt: '2026-02-02T10:15:00.000Z',
}

const TOTAL = 1284

interface AuditQuery {
  limit?: number
  offset?: number
  action?: string
  actorId?: string
  from?: string
  to?: string
}

let auditCalls: AuditQuery[] = []

function auditPage(query: AuditQuery) {
  auditCalls.push(query)
  if (query.action === 'project.deleted') {
    return {
      data: [DEEP_ROW],
      pageInfo: { hasNextPage: false, nextCursor: null, limit: 50, total: 1 },
    }
  }
  if (query.action) {
    return { data: [], pageInfo: { hasNextPage: false, nextCursor: null, limit: 50, total: 0 } }
  }
  return {
    data: FIRST_PAGE,
    pageInfo: { hasNextPage: true, nextCursor: null, limit: 50, total: TOTAL },
  }
}

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <AuditLogTab />
    </QueryClientProvider>,
  )
}

/** Reveal the filter row (it starts collapsed while no server filter is set). */
async function openFilters() {
  fireEvent.click(await screen.findByRole('button', { name: 'Filters' }))
}

async function chooseAction(label: string) {
  await openFilters()
  fireEvent.click(await screen.findByRole('button', { name: 'Filter by action' }))
  fireEvent.click(await screen.findByRole('button', { name: label }))
}

describe('AuditLogTab — P45-04 search reaches the whole log', () => {
  beforeEach(() => {
    auditCalls = []
    mockGET.mockReset()
    mockGET.mockImplementation((path: string, opts?: { params?: { query?: AuditQuery } }) => {
      if (path === '/v1/audit-logs') {
        return Promise.resolve({ data: auditPage(opts?.params?.query ?? {}) })
      }
      if (path === '/v1/workspaces/{id}/members-with-profile')
        return Promise.resolve({ data: [ADA] })
      if (path === '/v1/workspaces/{workspaceId}/teams') return Promise.resolve({ data: [] })
      if (path === '/v1/roles') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
  })

  it('finds an event that is NOT on the loaded page, by asking the server for it', async () => {
    renderTab()
    // Page one is 50 sign-ins; the deletion is 1,200-odd rows further back.
    expect(await screen.findAllByText('Signed in through SSO')).toHaveLength(50)
    expect(screen.queryByText('Deleted project Legacy Portal')).toBeNull()

    await chooseAction('Project Deleted')

    expect(await screen.findByText('Deleted project Legacy Portal')).toBeTruthy()
    // The filter travelled as a query parameter — the only way that row could arrive.
    await waitFor(() => expect(auditCalls.some((q) => q.action === 'project.deleted')).toBe(true))
    // And it reset to page one: an offset from the unfiltered list means nothing here.
    expect(auditCalls.at(-1)?.offset).toBe(0)
  })

  it('states the size of the matching set, not of the page', async () => {
    renderTab()
    expect(await screen.findByText(`1–50 of ${TOTAL}`)).toBeTruthy()
    // 1284 rows at 50 a page — the reader can see how much log is behind the window.
    expect(screen.getByText('Page 1 of 26')).toBeTruthy()

    await chooseAction('Project Deleted')
    expect(await screen.findByText('1–1 of 1')).toBeTruthy()
  })

  it('says so when the page-local box is what hid the rows', async () => {
    renderTab()
    await screen.findAllByText('Signed in through SSO')
    const callsBefore = auditCalls.length

    fireEvent.change(screen.getByLabelText('Filter this page…'), {
      target: { value: 'legacy portal' },
    })

    // The scope is named at the moment it would otherwise read as "this never happened".
    expect(
      await screen.findByText(/This box filters the 50 loaded rows only/, { exact: false }),
    ).toBeTruthy()
    // Deliberately no refetch: the box is not a server predicate, and pretending otherwise is
    // what a `q` param over `action`/`changes` would have done — matching ids, not sentences.
    expect(auditCalls.length).toBe(callsBefore)
  })

  it('distinguishes an empty workspace from an empty filter result', async () => {
    renderTab()
    await chooseAction('Team Created')
    expect(
      await screen.findByText('No audit event in this workspace matches these filters.'),
    ).toBeTruthy()
  })
})
