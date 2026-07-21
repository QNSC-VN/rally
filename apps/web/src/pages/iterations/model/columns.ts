import { type ColumnSpec } from '@/shared/ui/table'
import { type Iteration } from '@/features/iterations/api'

/**
 * Column descriptors for the Iterations grid — a single ColumnSpec[] consumed by
 * the shared `useDataTable` engine (resize / reorder / show-hide) and rendered
 * through `DataTableFrame`, replacing the hand-rolled flex-grid this page used to
 * carry (FRONTEND_COMPONENT_AUDIT §5.2). The leading iteration-key cell is a
 * gutter (frame `leading`), not a reorderable column.
 */
export type ColKey = 'name' | 'theme' | 'startDate' | 'endDate' | 'plannedVelocity' | 'state'

export const ITERATIONS_COLUMNS: ColumnSpec<Iteration, unknown, ColKey>[] = [
  { key: 'name', label: 'Name', defaultWidth: 220, minWidth: 120, locked: true },
  { key: 'theme', label: 'Theme', defaultWidth: 260, minWidth: 100 },
  { key: 'startDate', label: 'Start Date', defaultWidth: 130, minWidth: 90 },
  { key: 'endDate', label: 'End Date', defaultWidth: 130, minWidth: 90 },
  {
    key: 'plannedVelocity',
    label: 'Planned Velocity',
    defaultWidth: 130,
    minWidth: 80,
    align: 'right',
  },
  { key: 'state', label: 'State', defaultWidth: 120, minWidth: 80 },
]
