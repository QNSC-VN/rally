import { describe, expect, it } from 'vitest'
import { WORK_ITEM_VIEW_ROOTS } from '@/shared/api/invalidate-work-item-views'
import { workItemKeys, childDefectsKeys } from '@/features/work-items/api'
import { iterationKeys } from '@/features/iterations/api'
import { teamStatusKeys } from '@/features/team-status/api'
import { qualityKeys } from '@/features/quality/api'
import { portfolioKeys } from '@/features/portfolio/api'
import { reportingKeys } from '@/features/reporting/api'

/**
 * The shared invalidation helper stores query-key roots as literals to avoid a
 * feature-import cycle. This guard proves each literal still matches the real
 * root exported by its feature module, so a rename can never silently break
 * cross-view cache invalidation (the "edit reverts until reload" class of bug).
 */
describe('WORK_ITEM_VIEW_ROOTS', () => {
  const roots = WORK_ITEM_VIEW_ROOTS.map((r) => JSON.stringify(r))

  it.each([
    ['work-items', workItemKeys.all],
    ['iteration-status', iterationKeys.statusAll],
    ['team-status', teamStatusKeys.all],
    ['quality', qualityKeys.all],
    ['portfolio', portfolioKeys.all],
    ['reports', reportingKeys.all],
    ['child-defects', childDefectsKeys.all],
  ])('includes the canonical %s root', (_label, featureRoot) => {
    expect(roots).toContain(JSON.stringify(featureRoot))
  })

  it('covers exactly the known work-item read-models (no drift)', () => {
    expect(WORK_ITEM_VIEW_ROOTS).toHaveLength(7)
  })
})
