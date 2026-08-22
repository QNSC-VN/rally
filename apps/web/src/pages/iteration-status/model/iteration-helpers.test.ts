/**
 * The Iteration Status Totals row — `P2-IS-FR-016B/016C`.
 *
 * Pinned as a pure function rather than through the page: the page needs a dozen stores, feeds and
 * router primitives stubbed, and the thing under test is one reduce over the rows already on screen.
 */
import { describe, expect, it } from 'vitest'

import { iterationStatusTotals } from './iteration-helpers'

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
