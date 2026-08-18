/**
 * `useInitialProject` — a granted user must not land in a No Access shell.
 *
 * Every nav item and route guard resolves its permission against the SELECTED project, so with none
 * selected a per-project Admin holds nothing and sees Home plus Access Denied everywhere. A Workspace
 * Admin never saw it (`workspace:*` grants regardless of scope), which is why it survived until the
 * BA asked for a non-admin login.
 *
 * The two cases that matter most here are the ones that say NOTHING: an unresolved list and a failed
 * one both arrive as `undefined`, and deciding on either is the "state frozen before its source
 * arrived" defect this codebase has already paid for once.
 *
 * It is also the RECONCILER (GAP-P4-RBAC-003 AC5): the selection is persisted, so it outlives the
 * grant it was made under, and a resolved list is the server's own answer about what is still
 * readable. Both directions are asserted — a revoked project must be dropped, and an unresolved list
 * must drop nothing.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useInitialProject, type SelectableProject } from './use-initial-project'

const NXP: SelectableProject = {
  id: 'p-nxp',
  key: 'NXP',
  name: 'NextGen Platform',
  status: 'active',
}
const PAY: SelectableProject = { id: 'p-pay', key: 'PAY', name: 'Payments', status: 'active' }
const OLD: SelectableProject = { id: 'p-old', key: 'OLD', name: 'Retired', status: 'archived' }

const selected = () => useAppContext.getState().project

beforeEach(() => {
  useAppContext.setState({ project: null, team: null })
})

describe('useInitialProject', () => {
  it('selects the first ACTIVE project when the reader has none', () => {
    renderHook(() => useInitialProject([NXP, PAY]))
    expect(selected()).toEqual({
      projectId: 'p-nxp',
      projectKey: 'NXP',
      projectName: 'NextGen Platform',
    })
  })

  it('never selects an archived project, even as the only row', () => {
    renderHook(() => useInitialProject([OLD]))
    expect(selected()).toBeNull()
  })

  it('leaves the reader’s own choice alone while it is still readable', () => {
    useAppContext.setState({
      project: { projectId: 'p-pay', projectKey: 'PAY', projectName: 'Payments' },
    })
    renderHook(() => useInitialProject([NXP, PAY]))
    expect(selected()?.projectId).toBe('p-pay')
  })

  it('replaces a selection that is no longer readable, and clears the Team with it', () => {
    // Access revoked between sessions: the persisted project is absent from the list, so keeping it
    // would leave every screen refusing a project the reader cannot open.
    useAppContext.setState({
      project: { projectId: 'p-gone', projectKey: 'GONE', projectName: 'Removed' },
      team: { teamId: 't-1', teamName: 'Team Alpha' },
    })
    renderHook(() => useInitialProject([NXP]))
    expect(selected()?.projectId).toBe('p-nxp')
    // The Team belonged to the project being left.
    expect(useAppContext.getState().team).toBeNull()
  })

  it('selects NOTHING while the list is unresolved', () => {
    // `undefined` is both "loading" and "failed". Choosing on it would decide before the evidence
    // arrived — and on a failure it would overwrite a perfectly good persisted selection.
    useAppContext.setState({
      project: { projectId: 'p-pay', projectKey: 'PAY', projectName: 'Payments' },
    })
    renderHook(() => useInitialProject(undefined))
    expect(selected()?.projectId).toBe('p-pay')
  })

  it('selects NOTHING for a resolved EMPTY list — that is a real No Access principal', () => {
    renderHook(() => useInitialProject([]))
    expect(selected()).toBeNull()
  })

  /**
   * GAP-P4-RBAC-003 AC5. This is the case the hook used to `return` early on, and the return is what
   * shipped the leak: with nothing readable left, the REVOKED project stayed selected, so the shell's
   * context trigger kept printing `TEST · All Teams` and every project-scoped read kept being issued
   * for it. SRS §2.2 / §6: an unassigned user sees the project nowhere.
   */
  it('CLEARS a stale selection when the resolved list is EMPTY', () => {
    useAppContext.setState({
      project: { projectId: 'p-test', projectKey: 'TEST', projectName: 'Test Project' },
      team: { teamId: 't-1', teamName: 'Team Alpha' },
    })
    renderHook(() => useInitialProject([]))
    expect(selected()).toBeNull()
    expect(useAppContext.getState().team).toBeNull()
  })

  it('CLEARS a stale selection when only ARCHIVED projects remain', () => {
    // Same rule one step over: `active[0]` has no replacement to offer, and an archived project is
    // not a selectable context (the shell's picker only lists active rows).
    useAppContext.setState({
      project: { projectId: 'p-test', projectKey: 'TEST', projectName: 'Test Project' },
      team: { teamId: 't-1', teamName: 'Team Alpha' },
    })
    renderHook(() => useInitialProject([OLD]))
    expect(selected()).toBeNull()
    expect(useAppContext.getState().team).toBeNull()
  })

  it('does not clear on an UNRESOLVED list, even with nothing else to fall back to', () => {
    // A failed `GET /v1/projects` arrives as `undefined` too, and clearing on it would evict a reader
    // from their own project because the network blinked — the mirror of inventing a selection.
    useAppContext.setState({
      project: { projectId: 'p-test', projectKey: 'TEST', projectName: 'Test Project' },
    })
    renderHook(() => useInitialProject(undefined))
    expect(selected()?.projectKey).toBe('TEST')
  })

  it('does not thrash when the list identity changes but the choice is still valid', () => {
    const { rerender } = renderHook(
      ({ list }: { list: SelectableProject[] }) => useInitialProject(list),
      {
        initialProps: { list: [NXP, PAY] },
      },
    )
    expect(selected()?.projectId).toBe('p-nxp')
    // A refetch hands back an equal-but-new array; the selection must survive it.
    rerender({ list: [{ ...NXP }, { ...PAY }] })
    expect(selected()?.projectId).toBe('p-nxp')
  })
})
