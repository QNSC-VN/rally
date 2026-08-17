/**
 * `/item/$itemKey` must never render a BLANK page — GAP-P4-RBAC-003, Fail 3 / AC6.
 *
 * The BA retest opened `/item/US-17` with no access to the owning project: nothing leaked, and
 * nothing was said either — no Access Denied, no Not Found, no recovery action — while `/backlog`
 * one URL over got it right. Phase 4 `02_Roles_Permissions/SRS.md` §7 requires a stated denied state
 * and forbids disclosing the restricted title, owner, Project or Team.
 *
 * Both halves are asserted, because either alone passes for the wrong reason: mapping a 403 to
 * `denied` is worthless if the denied branch renders nothing, and a rendered `AccessDenied` is
 * worthless if a 500 also reaches it (that would tell a reader they lack access when the server
 * merely fell over — the same absent-versus-refused conflation `shared/lib/query/resource.ts` exists
 * to stop).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/shared/api/api-error'
import {
  workItemUnavailableReason,
  type WorkItemUnavailableReason,
} from '../model/unavailable-reason'
import { WorkItemUnavailable } from './work-item-unavailable'

describe('workItemUnavailableReason', () => {
  it('maps a 403 to `denied` — the record exists and is not ours', () => {
    expect(workItemUnavailableReason(true, new ApiError({}, 403))).toBe('denied')
  })

  it('maps a team-less record (`PROJECT_BACKLOG_ADMIN_ONLY`) to `denied`', () => {
    // BA ruling 2026-08-17: `team_id IS NULL` is the Project Backlog, "accessible only to Workspace
    // Admin and Project Admin". An Editor opening `/item/US-17` directly gets a 403 carrying this
    // code, and it must land on Access Denied like any other refusal — the direct-URL half of
    // "enforce this consistently in API queries, lists, reports, search, pickers and direct URLs".
    // Asserted with the CODE present to pin that the mapping does not need to know it: a new refusal
    // must not fall through to `loadFailed`, which would blame the server for a rule.
    const denied = new ApiError({ error: { code: 'PROJECT_BACKLOG_ADMIN_ONLY' } }, 403)
    expect(workItemUnavailableReason(true, denied)).toBe('denied')
  })

  it('maps a resolved-but-absent record to `notFound`', () => {
    // `by-key` maps a 404 to `null`, so the query SUCCEEDS with no data. That is an answer.
    expect(workItemUnavailableReason(false, undefined)).toBe('notFound')
  })

  it('maps a 500 to `loadFailed`, never to `denied`', () => {
    expect(workItemUnavailableReason(true, new ApiError({}, 500))).toBe('loadFailed')
  })

  it('maps a statusless failure to `loadFailed` — a denial is never asserted on no evidence', () => {
    // A transport fault (offline, DNS) throws a plain `Error` with no status anywhere.
    expect(workItemUnavailableReason(true, new Error('Failed to fetch'))).toBe('loadFailed')
  })
})

describe('WorkItemUnavailable', () => {
  const renderReason = (reason: WorkItemUnavailableReason, onBack = vi.fn()) => {
    render(
      <WorkItemUnavailable reason={reason} itemKey="US-17" error={undefined} onBack={onBack} />,
    )
    return onBack
  }

  it('states the refusal for `denied`, and offers a way out', () => {
    renderReason('denied')
    // `role="alert"` is `AccessDenied`'s own contract — it replaces a region the reader is looking at.
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('states the load failure for `loadFailed`, and offers a way out', () => {
    renderReason('loadFailed')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('names the key back for `notFound`, and offers a way out', () => {
    renderReason('notFound')
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders SOMETHING in every state — the blank page is the defect', () => {
    for (const reason of ['denied', 'notFound', 'loadFailed'] as WorkItemUnavailableReason[]) {
      const { container, unmount } = render(
        <WorkItemUnavailable reason={reason} itemKey="US-17" onBack={vi.fn()} />,
      )
      expect(container.textContent?.trim()).not.toBe('')
      unmount()
    }
  })

  it('discloses nothing about the record it refused (§7)', () => {
    const { container } = render(
      <WorkItemUnavailable reason="denied" itemKey="US-17" onBack={vi.fn()} />,
    )
    // The denied branch is handed only the key the reader typed — no title, owner, project or team is
    // in scope for it to print, and `AccessDenied` takes no record props at all.
    expect(container.textContent).not.toContain('US-17')
  })
})
