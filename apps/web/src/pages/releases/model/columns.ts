import { type ColumnSpec } from '@/shared/ui/table'
import { type Release } from '@/features/releases/api'

export type ColKey =
  | 'name'
  | 'theme'
  | 'version'
  | 'startDate'
  | 'releaseDate'
  | 'plannedVelocity'
  | 'taskEstimate'
  | 'state'
  | 'actions'

export const RELEASES_COLUMNS: ColumnSpec<Release, unknown, ColKey>[] = [
  { key: 'name', label: 'Name', defaultWidth: 200, minWidth: 120, locked: true },
  { key: 'theme', label: 'Theme', defaultWidth: 144, minWidth: 80 },
  { key: 'version', label: 'Version', defaultWidth: 80, minWidth: 50 },
  { key: 'startDate', label: 'Start Date', defaultWidth: 96, minWidth: 80 },
  { key: 'releaseDate', label: 'Release Date', defaultWidth: 96, minWidth: 80 },
  { key: 'plannedVelocity', label: 'Plan. Vel.', defaultWidth: 80, minWidth: 60, align: 'right' },
  { key: 'taskEstimate', label: 'Task Est.', defaultWidth: 64, minWidth: 50, align: 'right' },
  { key: 'state', label: 'State', defaultWidth: 112, minWidth: 80 },
  { key: 'actions', label: '', defaultWidth: 64, minWidth: 48, locked: true },
]
