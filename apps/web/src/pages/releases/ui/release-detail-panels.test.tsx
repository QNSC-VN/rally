/**
 * Release detail right panel — the Phase 3.2 scope contract.
 *
 * P3-REL-FR-023 makes the Task Roll-up "Estimate, To Do and Actual values from assigned
 * tasks/work items" — HOURS. P3-REL-FR-037 forbids a Release Progress column/widget on the Phase 3
 * list/detail, and §7.5 defers the release progress percentage, its zero-state, its formula and its
 * recalculation to `Portfolio > Release Tracking`.
 *
 * The panel shipped with the opposite of both: a `Completion` percentage with a progress bar, an
 * item/point roll-up under Estimate/To Do/Actual labels, and a Date/Total/Done/Remaining burndown
 * table below it. i18next is uninitialised under vitest, so `t()` returns the key — which is why
 * these assert on keys rather than on English copy.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TaskRollupPanel } from './release-detail-panels'

const ROLLUP = { estimateHours: 18.5, toDoHours: 6, actualHours: 12.5, acceptedItems: 3 }

describe('TaskRollupPanel', () => {
  it('renders Estimate / To Do / Actual as HOURS (FR-023) plus the Accepted total (FR-024)', () => {
    render(<TaskRollupPanel rollup={ROLLUP} />)

    expect(screen.getByText('detailPage.rollup.title')).toBeInTheDocument()
    expect(screen.getByText('detailPage.rollup.estimate')).toBeInTheDocument()
    expect(screen.getByText('18.5h')).toBeInTheDocument()
    expect(screen.getByText('detailPage.rollup.toDo')).toBeInTheDocument()
    expect(screen.getByText('6h')).toBeInTheDocument()
    expect(screen.getByText('detailPage.rollup.actual')).toBeInTheDocument()
    expect(screen.getByText('12.5h')).toBeInTheDocument()
    expect(screen.getByText('detailPage.rollup.accepted')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders no progress percentage and no progress bar (FR-037, §7.5)', () => {
    const { container } = render(<TaskRollupPanel rollup={ROLLUP} />)

    expect(screen.queryByText('detailPage.rollup.completion')).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    // The bar was a width-styled div; nothing in this panel may carry a computed width.
    expect(container.querySelector('[style*="width"]')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('exports no Burndown panel — release tracking is Phase 6, not Phase 3.2', async () => {
    const mod = await import('./release-detail-panels')
    expect(Object.keys(mod)).toEqual(['TaskRollupPanel'])
  })
})
