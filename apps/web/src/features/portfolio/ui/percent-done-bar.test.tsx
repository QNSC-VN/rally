import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

// The real bundle, so these assertions read the copy that ships rather than a stub.
import '@/shared/i18n/i18n'
import { BRAND } from '@/shared/config/brand'
import { PercentDoneBar } from './percent-done-bar'
import type { PortfolioItem } from '../api'

type Health = PortfolioItem['health']

const health = (over: Partial<Health> = {}): Health => ({
  state: 'on_track',
  percentDone: 0.5,
  percentElapsed: 0.5,
  indeterminate: null,
  ...over,
})

/** The bar's fill is the only element carrying an inline width. */
function fill(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[style*="width"]')
}

const progress = (over: Partial<PortfolioItem['progress']> = {}): PortfolioItem['progress'] => ({
  percentDoneByPlanEstimate: 0.5,
  percentDoneByCount: 0.5,
  estimatedProgressByPoints: 0.5,
  estimatedProgressByCount: 0.5,
  ...over,
})

const rollup = (over: Partial<PortfolioItem['rollup']> = {}): PortfolioItem['rollup'] => ({
  rollupPoints: 20,
  rollupCount: 4,
  acceptedPoints: 10,
  acceptedCount: 2,
  completedPoints: 10,
  completedCount: 2,
  ...over,
})

function renderBar(h: Health, over: Partial<PortfolioItem['progress']> = {}) {
  return render(
    <PercentDoneBar metric="points" health={h} progress={progress(over)} rollup={rollup()} />,
  )
}

describe('PercentDoneBar', () => {
  it('paints Rally colour per status, not per ratio', () => {
    // Same ratio in every case: the colour comes from the schedule comparison the server
    // made, so an identical 50% is green, yellow or red depending on the planned window.
    expect(fill(renderBar(health({ state: 'on_track' })).container)?.style.backgroundColor).toBe(
      BRAND.success,
    )
    expect(fill(renderBar(health({ state: 'at_risk' })).container)?.style.backgroundColor).toBe(
      BRAND.warning,
    )
    expect(fill(renderBar(health({ state: 'late' })).container)?.style.backgroundColor).toBe(
      BRAND.danger,
    )
  })

  it('uses BLUE for complete, so it is distinguishable from on track', () => {
    // Rally's blue means "past the planned end AND done". Reusing green would erase the
    // difference between finished and merely on schedule.
    const complete = fill(renderBar(health({ state: 'complete' })).container)?.style.backgroundColor
    const onTrack = fill(renderBar(health({ state: 'on_track' })).container)?.style.backgroundColor
    expect(complete).toBe(BRAND.primaryLight)
    expect(complete).not.toBe(onTrack)
  })

  it('greys out an item with no verdict instead of implying one', () => {
    const grey = fill(
      renderBar(health({ state: 'not_started', indeterminate: 'no_dates' })).container,
    )?.style.backgroundColor
    expect(grey).toBe(BRAND.statusDefault)
  })

  it("names BOTH denominators in the callout, like Rally's hover", () => {
    // Rally's callout lists Status, Accepted Points and Accepted User Stories together, so
    // hovering either column answers the same questions. Composing this per call site is
    // what let the grid and the detail page drift before.
    const { container } = renderBar(health({ state: 'late' }))
    const tip = container.querySelector('[title]')?.getAttribute('title')
    expect(tip).toContain('Status:')
    expect(tip).toContain('Accepted points: 10 of 20')
    expect(tip).toContain('Accepted items: 2 of 4')
  })

  it('reads the ratio for the metric it was asked for', () => {
    // The two columns divide by different denominators; swapping them would show Percent
    // Done by Count under the points heading and look plausible while being wrong.
    const p = progress({ percentDoneByPlanEstimate: 0.25, percentDoneByCount: 0.75 })
    const points = render(
      <PercentDoneBar metric="points" health={health()} progress={p} rollup={rollup()} />,
    )
    expect(fill(points.container)?.style.width).toBe('25%')

    const count = render(
      <PercentDoneBar metric="count" health={health()} progress={p} rollup={rollup()} />,
    )
    expect(fill(count.container)?.style.width).toBe('75%')
  })

  it('explains WHY there is no status when the item is indeterminate', () => {
    // A grey bar with no explanation looks like a bug. Rally names the missing data.
    const { container } = renderBar(health({ state: 'not_started', indeterminate: 'no_dates' }))
    expect(container.querySelector('[title]')?.getAttribute('title')).toContain('dates are missing')
  })

  it('still shows the placeholder when nothing is measurable', () => {
    // No linked work means no denominator; a null ratio must stay a dash rather than
    // becoming a coloured 0% bar that claims the status applies to real progress.
    const { container } = renderBar(health({ state: 'not_started', indeterminate: 'no_work' }), {
      percentDoneByPlanEstimate: null,
    })
    expect(fill(container)).toBeNull()
    expect(container.textContent).toContain('—')
    // The explanation survives the empty state — it is the only thing on the bar.
    expect(container.querySelector('[title]')?.getAttribute('title')).toContain('no estimated work')
  })
})
