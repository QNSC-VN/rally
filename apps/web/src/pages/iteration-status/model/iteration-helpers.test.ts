/**
 * The Iteration Status Totals row — `P2-IS-FR-016B/016C`.
 *
 * Pinned as a pure function rather than through the page: the page needs a dozen stores, feeds and
 * router primitives stubbed, and the thing under test is one reduce over the rows already on screen.
 */
import { describe, expect, it } from 'vitest'

import { iterationStatusTotals, sortStatusRows, stepIndexInTime } from './iteration-helpers'

describe('iterationStatusTotals', () => {
  it('sums Plan Est, and Task Est as To Do + Actual', () => {
    const totals = iterationStatusTotals([
      { planEstimate: 3, toDo: 4, actual: 2 },
      { planEstimate: 5, toDo: 1, actual: 6 },
    ])

    expect(totals.planEst).toBe(8)
    // 4 + 2 + 1 + 6 — remaining plus spent, per FR-016C and §240.
    expect(totals.taskEst).toBe(13)
    expect(totals.toDoSum).toBe(5)
    expect(totals.count).toBe(2)
  })

  it('treats an absent number as nothing, never as a measured zero it can subtract', () => {
    // The rows carry nullable hours: an unestimated Story contributes nothing rather than skewing
    // the total, and `undefined + 0` would make the whole row `NaN` — which renders as `NaN h`.
    const totals = iterationStatusTotals([
      { planEstimate: null, toDo: null, actual: null },
      { toDo: 2 },
    ])

    expect(totals).toEqual({ planEst: 0, taskEst: 2, toDoSum: 2, count: 2 })
  })

  it('is zero for an empty scope, and says so with a count of zero', () => {
    expect(iterationStatusTotals([])).toEqual({ planEst: 0, taskEst: 0, toDoSum: 0, count: 0 })
  })
})

describe('sortStatusRows', () => {
  const row = (over: Partial<Parameters<typeof sortStatusRows>[0][number]> = {}) => ({
    rank: 'a',
    itemKey: 'US-1',
    title: 'Row',
    scheduleState: 'defined',
    isBlocked: false,
    ...over,
  })

  it('sorts Owner by the NAME the cell renders, not by the id', () => {
    // The defect: this compared `assigneeId`, so the header offered a sort and produced a uuid
    // order — arbitrary to a reader, and indistinguishable from a broken sort.
    const rows = [
      row({ itemKey: 'US-1', assigneeName: 'Zoe Adams' }),
      row({ itemKey: 'US-2', assigneeName: 'Alice Smith' }),
    ]

    expect(sortStatusRows(rows, 'owner', 'asc').map((r) => r.itemKey)).toEqual(['US-2', 'US-1'])
    expect(sortStatusRows(rows, 'owner', 'desc').map((r) => r.itemKey)).toEqual(['US-1', 'US-2'])
  })

  it('sorts Dev Owner too — its header used to be inert', () => {
    const rows = [
      row({ itemKey: 'US-1', devOwnerName: 'Bob' }),
      row({ itemKey: 'US-2', devOwnerName: 'Ann' }),
    ]

    expect(sortStatusRows(rows, 'devOwner', 'asc').map((r) => r.itemKey)).toEqual(['US-2', 'US-1'])
  })

  it('orders Flow State by the Schedule State it mirrors', () => {
    // Flow State had no mapping and fell through to "return 0", so its header did nothing at all.
    const rows = [
      row({ itemKey: 'US-1', scheduleState: 'in_progress' }),
      row({ itemKey: 'US-2', scheduleState: 'accepted' }),
    ]

    expect(sortStatusRows(rows, 'flowState', 'asc').map((r) => r.itemKey)).toEqual(['US-2', 'US-1'])
  })

  it('puts rows with no value LAST ascending and FIRST descending', () => {
    // The shared keyset rule (ASC → NULLS LAST). Comparing an absent owner as '' instead would
    // float every unassigned row to the top of an A-Z sort.
    const rows = [
      row({ itemKey: 'US-1' }),
      row({ itemKey: 'US-2', assigneeName: 'Ann' }),
      row({ itemKey: 'US-3', assigneeName: 'Bob' }),
    ]

    expect(sortStatusRows(rows, 'owner', 'asc').map((r) => r.itemKey)).toEqual([
      'US-2',
      'US-3',
      'US-1',
    ])
    expect(sortStatusRows(rows, 'owner', 'desc').map((r) => r.itemKey)).toEqual([
      'US-1',
      'US-3',
      'US-2',
    ])
  })

  it('leaves the rows alone for no column, and for a column it does not map', () => {
    const rows = [row({ itemKey: 'US-2' }), row({ itemKey: 'US-1' })]

    expect(sortStatusRows(rows, null, 'asc')).toBe(rows)
    // `feature` and `iteration` carry no sort affordance; an unmapped key must not reorder anything.
    expect(sortStatusRows(rows, 'feature', 'asc').map((r) => r.itemKey)).toEqual(['US-2', 'US-1'])
  })

  it('treats an unestimated row as absent, not as a zero it can rank', () => {
    const rows = [
      row({ itemKey: 'US-1', planEstimate: null }),
      row({ itemKey: 'US-2', planEstimate: 0 }),
      row({ itemKey: 'US-3', planEstimate: 5 }),
    ]

    // A deliberate 0 ranks below 5; the unestimated row goes last.
    expect(sortStatusRows(rows, 'planEstimate', 'asc').map((r) => r.itemKey)).toEqual([
      'US-2',
      'US-3',
      'US-1',
    ])
  })
})

describe('stepIndexInTime — the iteration chevrons follow chronology', () => {
  /**
   * The feed is NEWEST FIRST (`desc(startDate)` server-side), so index 0 is the latest sprint. The
   * arrows used to pass `-1` for left and `+1` for right, which reversed both of them: from KB
   * Sprint 1 the left chevron advanced to KB Sprint 2 (Production, 2026-08-21).
   *
   * Written against a three-sprint list in feed order — [Sprint 3, Sprint 2, Sprint 1] — so the
   * assertions read as chronology rather than as arithmetic.
   */
  const LATEST = 0
  const MIDDLE = 1
  const EARLIEST = 2
  const COUNT = 3

  it('steps EARLIER by moving FORWARD through a newest-first list', () => {
    expect(stepIndexInTime(LATEST, 'earlier', COUNT)).toBe(MIDDLE)
    expect(stepIndexInTime(MIDDLE, 'earlier', COUNT)).toBe(EARLIEST)
  })

  it('steps LATER by moving BACK through it', () => {
    expect(stepIndexInTime(EARLIEST, 'later', COUNT)).toBe(MIDDLE)
    expect(stepIndexInTime(MIDDLE, 'later', COUNT)).toBe(LATEST)
  })

  it('stops at each end, and the end it stops at matches the direction', () => {
    // Left disabled at the EARLIEST iteration, right disabled at the LATEST — the BA's own
    // disabled-state rule, and it is the same expression the arrows are greyed out by.
    expect(stepIndexInTime(EARLIEST, 'earlier', COUNT)).toBeNull()
    expect(stepIndexInTime(LATEST, 'later', COUNT)).toBeNull()
  })

  it('answers null for no selection and for an empty feed', () => {
    // `findIndex` returns -1 while the feed is loading; stepping from there must not select row 0.
    expect(stepIndexInTime(-1, 'earlier', COUNT)).toBeNull()
    expect(stepIndexInTime(-1, 'later', COUNT)).toBeNull()
    expect(stepIndexInTime(0, 'earlier', 0)).toBeNull()
  })
})
