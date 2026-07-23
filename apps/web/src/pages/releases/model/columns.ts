import { type ColumnSpec } from '@/shared/ui/table'
import { type Release } from '@/features/releases/api'

export type ColKey =
  | 'id'
  | 'name'
  | 'theme'
  | 'version'
  | 'startDate'
  | 'releaseDate'
  | 'project'
  | 'plannedVelocity'
  | 'taskEstimate'
  | 'state'

export const RELEASES_COLUMNS: ColumnSpec<Release, unknown, ColKey>[] = [
  { key: 'id', label: 'ID', defaultWidth: 84, minWidth: 60, locked: true, sortCol: 'releaseKey' },
  { key: 'name', label: 'Name', defaultWidth: 200, minWidth: 120, locked: true, grow: true, sortCol: 'name' },
  { key: 'theme', label: 'Theme', defaultWidth: 144, minWidth: 80, sortCol: 'theme' },
  { key: 'version', label: 'Version', defaultWidth: 80, minWidth: 50, sortCol: 'version' },
  { key: 'startDate', label: 'Start Date', defaultWidth: 96, minWidth: 80, sortCol: 'startDate' },
  {
    key: 'releaseDate',
    label: 'Release Date',
    defaultWidth: 96,
    minWidth: 80,
    sortCol: 'releaseDate',
  },
  { key: 'project', label: 'Project', defaultWidth: 140, minWidth: 90, sortCol: 'project' },
  {
    key: 'plannedVelocity',
    label: 'Plan. Vel.',
    defaultWidth: 110,
    minWidth: 90,
    align: 'right',
    sortCol: 'plannedVelocity',
  },
  {
    key: 'taskEstimate',
    label: 'Task Est.',
    defaultWidth: 104,
    minWidth: 84,
    align: 'right',
    sortCol: 'taskEstimate',
  },
  { key: 'state', label: 'State', defaultWidth: 112, minWidth: 80, sortCol: 'state' },
]
