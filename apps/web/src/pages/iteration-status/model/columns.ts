import { type ColumnSpec } from '@/shared/ui/table'

export type ColKey =
  | 'rank'
  | 'id'
  | 'name'
  | 'feature'
  | 'iteration'
  | 'state'
  | 'block'
  | 'blockedReason'
  | 'planEstimate'
  | 'taskEstimate'
  | 'toDo'
  | 'tasksPct'
  | 'actual'
  | 'owner'
  | 'defects'
  | 'defectStatus'
  | 'milestones'
  | 'devOwner'

export const ITERATION_STATUS_COLUMNS: ColumnSpec<unknown, unknown, ColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 60, minWidth: 56 },
  { key: 'id', label: 'ID', defaultWidth: 132, minWidth: 120 },
  { key: 'name', label: 'Name', defaultWidth: 240, minWidth: 150 },
  { key: 'feature', label: 'Feature', defaultWidth: 200, minWidth: 120 },
  { key: 'iteration', label: 'Iteration', defaultWidth: 160, minWidth: 120 },
  { key: 'state', label: 'Schedule State', defaultWidth: 132, minWidth: 132 },
  { key: 'block', label: 'Block', defaultWidth: 60, minWidth: 56 },
  { key: 'blockedReason', label: 'Blocked Reason', defaultWidth: 160, minWidth: 100 },
  { key: 'planEstimate', label: 'Plan Estimate', defaultWidth: 80 },
  { key: 'taskEstimate', label: 'Task Estimate', defaultWidth: 80 },
  { key: 'toDo', label: 'To Do', defaultWidth: 70 },
  { key: 'tasksPct', label: 'Tasks', defaultWidth: 110, minWidth: 80 },
  { key: 'actual', label: 'Actual', defaultWidth: 70 },
  { key: 'owner', label: 'Owner', defaultWidth: 130 },
  { key: 'defects', label: 'Defects', defaultWidth: 60 },
  { key: 'defectStatus', label: 'Defect Status', defaultWidth: 100, minWidth: 80 },
  { key: 'milestones', label: 'Milestones', defaultWidth: 140, minWidth: 90 },
  { key: 'devOwner', label: 'Dev Owner', defaultWidth: 130 },
]

// Sentinel for the Owner filter's "Unassigned" option (empty string collides
// with the native <select> placeholder, so use an explicit token).
export const OWNER_UNASSIGNED = '__unassigned__'
