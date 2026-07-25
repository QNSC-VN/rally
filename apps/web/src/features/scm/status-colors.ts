import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { ScmRepository } from './api'

/** The `status` union of a repo's latest backfill (`ScmRepositoryResponseDto.lastSync`). */
export type ScmSyncStatus = NonNullable<ScmRepository['lastSync']>['status']

/**
 * Backfill (sync) status → badge colors, mirroring the release/milestone maps.
 * `done` → success, `pending` (queued/running) → warning, `failed` → danger.
 * A repo that has never synced (`lastSync === null`) renders a neutral badge
 * from {@link NEVER_SYNCED_STYLE} instead.
 */
export const SCM_SYNC_STATUS_STYLE: Record<ScmSyncStatus, StatusStyle> = {
  done: { bg: BRAND.successBg, text: BRAND.success, border: BRAND.successBorder, label: 'Synced' },
  pending: {
    bg: BRAND.warningBg,
    text: BRAND.warning,
    border: BRAND.warningBorder,
    label: 'Syncing',
  },
  failed: { bg: BRAND.dangerBg, text: BRAND.danger, border: BRAND.dangerBorder, label: 'Failed' },
}

export const NEVER_SYNCED_STYLE: StatusStyle = {
  bg: 'var(--surface-subtle)',
  text: 'var(--foreground-subtle)',
  border: 'var(--border-subtle)',
  label: 'Not synced',
}
