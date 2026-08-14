/**
 * Notification deep links (`P01-06`) — `SCR-11 … thiếu deep-link`, "`Go to item` chưa deep-link"
 * (`mini_rally_ui_business_review.md` :74, :218).
 *
 * This hook's job shrank, and the shrinking IS the fix. It used to switch the active project itself
 * before navigating, resolving the target project out of the workspace's project LIST. Two faults in
 * one:
 *
 *   - It sat on the CLICK, so it only ever ran for someone clicking the bell. The URL that click
 *     produces — pasted into chat, bookmarked, mailed — reached the right record under the
 *     RECIPIENT's last-selected project. The route loaders own the adoption now
 *     (`shared/lib/deep-link-project.ts`), so the click and the shared link take one code path.
 *   - `useProjects` fetches `limit: 100` and filters client-side, so past 100 projects the switch
 *     silently did not happen at all.
 *
 * So the assertion that matters here is a NEGATIVE one: clicking must navigate to the record's own
 * route and must NOT touch the selected project. A test that only checked `navigate` was called
 * would pass against the old code too.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const markRead = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
vi.mock('./api', () => ({ useMarkNotificationRead: () => markRead }))
/**
 * The hook no longer imports this — the mock is here so the negative verification is reproducible.
 * Re-introduce the old `useProjects` + `setProject` block and this list makes the switch SUCCEED,
 * which is what "does NOT switch the project itself" below then catches. Without the mock that
 * revert would throw instead, and a test that fails because a module is missing proves nothing about
 * behaviour.
 */
vi.mock('@/features/projects/api', () => ({
  useProjects: () => ({ data: [{ id: 'p-pay', key: 'PAY', name: 'Payments Platform' }] }),
}))

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useOpenNotification } from './use-open-notification'
import type { Notification } from './api'

const NXP = { projectId: 'p-nxp', projectKey: 'NXP', projectName: 'NextGen Platform' }

function notification(partial: Partial<Notification>): Notification {
  return {
    id: 'n-1',
    type: 'WORK_ITEM_ASSIGNED',
    title: 'US-2 assigned to you',
    body: null,
    resourceType: 'work_item',
    resourceId: 'wi-1',
    metadata: {},
    isRead: true,
    readAt: null,
    actorId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function open(n: Notification) {
  const { result } = renderHook(() => useOpenNotification(), { wrapper })
  result.current(n)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppContext.setState({ project: NXP, team: null })
})

describe('opening a notification about another project’s work item', () => {
  /** `US-2` is the seeded PAY story; the reader is sitting on NXP. */
  const crossProject = notification({
    resourceType: 'work_item',
    metadata: { itemKey: 'US-2', projectId: 'p-pay' },
  })

  it('navigates to the item’s own deep-link route', () => {
    open(crossProject)

    expect(navigate).toHaveBeenCalledWith({
      to: '/item/$itemKey',
      params: { itemKey: 'US-2' },
    })
  })

  it('does NOT switch the project itself — the route resolves it', () => {
    open(crossProject)

    // The click handler guessing the project from a `limit: 100` list is the defect. The route's
    // loader asks `GET /projects/{id}` for exactly the project the record names, so this handler has
    // nothing left to decide and cannot get it wrong.
    expect(useAppContext.getState().project).toEqual(NXP)
  })

  it('falls back to resourceId for a row written before the templates threaded the key', () => {
    open(notification({ resourceType: 'work_item', metadata: {}, resourceId: 'US-9' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/item/$itemKey', params: { itemKey: 'US-9' } })
  })

  it('marks an unread notification read on the way', () => {
    open(notification({ ...crossProject, isRead: false }))

    expect(markRead.mutateAsync).toHaveBeenCalledWith('n-1')
  })
})

describe('opening a notification about another project’s release', () => {
  it('navigates to the release detail deep link, project unchanged', () => {
    open(notification({ resourceType: 'release', resourceId: 'r-pay', metadata: {} }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/releases/$releaseId',
      params: { releaseId: 'r-pay', milestoneId: 'r-pay' },
    })
    expect(useAppContext.getState().project).toEqual(NXP)
  })
})

describe('a notification with nothing to open', () => {
  it('does not navigate when there is no resourceType', () => {
    open(notification({ resourceType: null }))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not navigate for a resourceType with no route', () => {
    // `user` is written by the audit fixtures, not by any notification template — a row that maps to
    // no screen must be inert rather than dumping the reader somewhere arbitrary.
    open(notification({ resourceType: 'user', resourceId: 'u-1' }))
    expect(navigate).not.toHaveBeenCalled()
  })
})
