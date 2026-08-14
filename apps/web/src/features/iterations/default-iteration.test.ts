/**
 * `defaultIterationId` — the default is a DOMAIN choice, not row order.
 *
 * Every list here is ordered so that `[0]` is the WRONG answer, because `iterations[0]` is what these
 * surfaces used and it is what broke: the reference feed orders `startDate DESC` while the record list
 * it replaced ordered `createdAt ASC`, so the default became a sprint with no work in it. Iteration
 * Status rendered no rows and the Burndown no series — both of which read as "this sprint is empty"
 * rather than "you are looking at the wrong sprint".
 *
 * The state cases carry the second half of that lesson. A date-only rule (pick the latest window that
 * has started) was written first and was ALSO wrong on real data: the seeded project's most recently
 * started sprint is in `planning`, which has no breakdown and no recorded history, so the screens
 * stayed empty and both Playwright journeys stayed red. "Current" means the sprint being EXECUTED.
 */
import { describe, expect, it } from 'vitest'

import { defaultIterationId } from './default-iteration'

const NOW = '2026-08-15'

const iter = (id: string, state: string, startDate: string | null, endDate: string | null) => ({
  id,
  state,
  startDate,
  endDate,
})

describe('defaultIterationId', () => {
  it('prefers the COMMITTED sprint over one that merely started later', () => {
    // The exact shape of the seeded project on the day this was written, and of the regression: every
    // window is in the past, and the latest to start is the planning one.
    const list = [
      iter('planning-26.2', 'planning', '2026-06-29', '2026-07-10'),
      iter('committed-26.1', 'committed', '2026-06-16', '2026-06-27'),
      iter('accepted-25.12', 'accepted', '2026-06-01', '2026-06-12'),
    ]
    expect(defaultIterationId(list, NOW)).toBe('committed-26.1')
  })

  it('picks the committed sprint whose window contains today when there is one', () => {
    const list = [
      iter('future', 'committed', '2026-09-01', '2026-09-14'),
      iter('current', 'committed', '2026-08-10', '2026-08-23'),
      iter('older', 'committed', '2026-07-27', '2026-08-09'),
    ]
    expect(defaultIterationId(list, NOW)).toBe('current')
  })

  it('takes the latest STARTED committed sprint when none contains today', () => {
    const list = [
      iter('next', 'committed', '2026-09-01', '2026-09-14'),
      iter('just-ended', 'committed', '2026-07-27', '2026-08-09'),
    ]
    expect(defaultIterationId(list, NOW)).toBe('just-ended')
  })

  it('looks BACK at the latest accepted sprint when nothing is committed', () => {
    const list = [
      iter('next', 'planning', '2026-09-01', '2026-09-14'),
      iter('older', 'accepted', '2026-06-01', '2026-06-12'),
      iter('just-closed', 'accepted', '2026-07-27', '2026-08-09'),
    ]
    expect(defaultIterationId(list, NOW)).toBe('just-closed')
  })

  it('offers the EARLIEST planning sprint when nothing has been committed or accepted', () => {
    const list = [
      iter('later', 'planning', '2026-10-01', '2026-10-14'),
      iter('sooner', 'planning', '2026-09-01', '2026-09-14'),
    ]
    expect(defaultIterationId(list, NOW)).toBe('sooner')
  })

  it('chooses a committed sprint even with no window at all', () => {
    // State leads: an undated committed sprint is still the sprint being worked.
    const list = [
      iter('dated-planning', 'planning', '2026-09-01', '2026-09-14'),
      iter('undated', 'committed', null, null),
    ]
    expect(defaultIterationId(list, NOW)).toBe('undated')
  })

  it('still answers for a state it does not know', () => {
    expect(defaultIterationId([iter('a', 'archived', null, null)], NOW)).toBe('a')
  })

  it('returns null for an empty list', () => {
    expect(defaultIterationId([], NOW)).toBeNull()
  })

  it('does not mutate or re-order the caller’s array', () => {
    // The picker renders this same array; a sort here would silently reorder what the reader sees.
    const list = [
      iter('planning-26.2', 'planning', '2026-06-29', '2026-07-10'),
      iter('committed-26.1', 'committed', '2026-06-16', '2026-06-27'),
    ]
    const before = list.map((i) => i.id)
    defaultIterationId(list, NOW)
    expect(list.map((i) => i.id)).toEqual(before)
  })
})
