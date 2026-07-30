import { type ColumnSpec } from '@/shared/ui/table'
import { type CapacityPlan, type CapacityPlanTeam } from '@/features/capacity-planning/api'

export type PlanColKey = 'name' | 'release' | 'unit' | 'status' | 'targetLoad' | 'capacity'

/**
 * The capacity-plans list.
 *
 * `capacity` has no `sortCol`: it is summed on read from the team rows, so there is no
 * column to sort by server-side and offering it would sort by nothing.
 */
export const CAPACITY_PLAN_COLUMNS: ColumnSpec<CapacityPlan, unknown, PlanColKey>[] = [
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 260,
    minWidth: 140,
    locked: true,
    grow: true,
    sortCol: 'name',
  },
  { key: 'release', label: 'Release', defaultWidth: 160, minWidth: 100 },
  { key: 'unit', label: 'Unit', defaultWidth: 90, minWidth: 70 },
  { key: 'status', label: 'Status', defaultWidth: 110, minWidth: 80, sortCol: 'status' },
  { key: 'targetLoad', label: 'Target Load', defaultWidth: 110, minWidth: 90, align: 'right' },
  { key: 'capacity', label: 'Capacity', defaultWidth: 110, minWidth: 90, align: 'right' },
]

export type TeamColKey = 'team' | 'capacity' | 'actions'

/**
 * The team grid inside one plan.
 *
 * Deliberately narrow for this slice: Complete / Rollup / Estimated all derive from
 * ALLOCATIONS, which do not exist yet, so columns for them would render empty and imply
 * the numbers were zero rather than absent.
 */
export const CAPACITY_TEAM_COLUMNS: ColumnSpec<CapacityPlanTeam, unknown, TeamColKey>[] = [
  { key: 'team', label: 'Team', defaultWidth: 280, minWidth: 140, locked: true, grow: true },
  { key: 'capacity', label: 'Capacity', defaultWidth: 140, minWidth: 100, align: 'right' },
  { key: 'actions', label: '', defaultWidth: 60, minWidth: 60, align: 'center' },
]
