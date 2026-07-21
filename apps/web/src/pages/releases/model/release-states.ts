import { type ReleaseStatus } from '@/features/releases/api'

/**
 * The selectable release lifecycle states, in order. Single source of truth for
 * the list page (row + modals) and the detail page — previously duplicated as a
 * local `RELEASE_STATES` array + `STATUS_STYLE` alias in three places.
 *
 * Colours/labels come from `RELEASE_STATUS_STYLE` (feature-owned status map),
 * re-exported here so consumers get states + styling from one import.
 */
export const RELEASE_STATES: ReleaseStatus[] = ['planning', 'active', 'accepted']

export { RELEASE_STATUS_STYLE } from '@/features/releases/status-colors'
