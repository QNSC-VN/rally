import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { runInvalidation, INVALIDATION_MAP } from './invalidation'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('runInvalidation', () => {
  it('does nothing when meta is undefined', () => {
    const qc = makeClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    runInvalidation(qc, undefined)
    expect(spy).not.toHaveBeenCalled()
  })

  it('expands entity tags into their registry roots', () => {
    const qc = makeClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    runInvalidation(qc, { invalidates: ['iteration'] })
    for (const queryKey of INVALIDATION_MAP.iteration) {
      expect(spy).toHaveBeenCalledWith({ queryKey })
    }
    expect(spy).toHaveBeenCalledTimes(INVALIDATION_MAP.iteration.length)
  })

  it('invalidates explicit narrow keys (instance-specific sub-resources)', () => {
    const qc = makeClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    runInvalidation(qc, { invalidateKeys: [['work-item-relations', 'wi-1']] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-item-relations', 'wi-1'] })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates roots shared across multiple tags', () => {
    const qc = makeClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    // Both tags include the work-item view roots; each root must fire once.
    runInvalidation(qc, { invalidates: ['work-item', 'iteration'] })
    const calls = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    )
    expect(new Set(calls).size).toBe(calls.length)
  })
  /**
   * AC6 of the Workspace-Admin team-membership ruling: "Team details and other membership views must
   * agree after a change." A team add/remove tags `team`, and the User Management roster carries each
   * member's `teams` array under its OWN root (`workspace-members-profile`), so without this the two
   * membership views disagreed until something else happened to invalidate the workspace namespace.
   */
  it("the team tag reaches the workspace roster, which carries each member's teams array", () => {
    const keys = INVALIDATION_MAP.team.map((k) => JSON.stringify(k))
    expect(keys).toContain(JSON.stringify(['workspace-members-profile']))
    // The team namespace itself covers the roster, the memberships fan-out and `memberCount` by
    // prefix — `teamKeys.members` / `.projectTeams` all live under `['teams']`.
    expect(keys).toContain(JSON.stringify(['teams']))
  })
})
