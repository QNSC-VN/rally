import { type PortfolioItem } from '@/features/portfolio/api'

/**
 * Does this row have anything to disclose? Drives whether the grid offers the expand
 * chevron at all, so the user never opens a row onto an empty list.
 *
 * The two levels count DIFFERENT things, which is the whole reason this is a function
 * and not a field: an Epic's children are Features (`childFeatureCount`, which the list
 * response already carries), while a Feature's children are the Stories and Defects
 * linked to it — counted by `rollup.rollupCount`, because the rollup is computed over
 * exactly that set. Reading `childFeatureCount` for a Feature would always give 0 (the
 * API documents it as Epic-only) and the chevron would never appear.
 */
export function hasChildren(item: PortfolioItem): boolean {
  return item.type === 'epic' ? item.childFeatureCount > 0 : item.rollup.rollupCount > 0
}
