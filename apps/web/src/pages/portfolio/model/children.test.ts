import { describe, expect, it } from 'vitest'

import { type PortfolioItem } from '@/features/portfolio/api'
import { hasChildren } from './children'

/**
 * The two levels count different fields, and getting that wrong is silent: the chevron
 * simply never appears on one of the two types. These cases pin the mapping.
 */
function item(patch: Partial<PortfolioItem>): PortfolioItem {
  return {
    type: 'feature',
    childFeatureCount: 0,
    rollup: {
      rollupPoints: 0,
      rollupCount: 0,
      acceptedPoints: 0,
      acceptedCount: 0,
      completedPoints: 0,
      completedCount: 0,
    },
    ...patch,
  } as PortfolioItem
}

describe('hasChildren', () => {
  it('an Epic is expandable when it has child Features', () => {
    expect(hasChildren(item({ type: 'epic', childFeatureCount: 3 }))).toBe(true)
    expect(hasChildren(item({ type: 'epic', childFeatureCount: 0 }))).toBe(false)
  })

  it('an Epic ignores the rollup count — its children are Features, not Stories', () => {
    const rollup = { ...item({}).rollup, rollupCount: 12 }
    expect(hasChildren(item({ type: 'epic', childFeatureCount: 0, rollup }))).toBe(false)
  })

  it('a Feature is expandable when Stories or Defects are linked', () => {
    const rollup = { ...item({}).rollup, rollupCount: 1 }
    expect(hasChildren(item({ type: 'feature', rollup }))).toBe(true)
    expect(hasChildren(item({ type: 'feature' }))).toBe(false)
  })

  it('a Feature ignores childFeatureCount — the API documents it as Epic-only', () => {
    expect(hasChildren(item({ type: 'feature', childFeatureCount: 5 }))).toBe(false)
  })
})
