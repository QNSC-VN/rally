import { type ColumnSpec } from '@/shared/ui/table'
import {
  type CapacityPlan,
  type CapacityPlanItem,
  type CapacityPlanTeam,
} from '@/features/capacity-planning/api'

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

export type TeamColKey = 'team' | 'features' | 'progress' | 'capacity' | 'actions'

/**
 * The team grid inside one plan.
 *
 * ONE `progress` column carries Complete / Rollup / Estimated together via
 * `CompositeBar`, rather than three numeric columns. Rally draws them as one bar against
 * the capacity baseline because the comparison IS the information — three separate columns
 * would make the reader do the subtraction that the bar shows at a glance.
 *
 * `capacity` doubles as the editable cell: a team row holds its entered ceiling, and an
 * allocated Feature row beneath it holds that team's committed value.
 */
export const CAPACITY_TEAM_COLUMNS: ColumnSpec<CapacityPlanTeam, unknown, TeamColKey>[] = [
  {
    key: 'team',
    label: 'Team / Feature',
    defaultWidth: 320,
    minWidth: 180,
    locked: true,
    grow: true,
  },
  // Its own column, with a header, rather than a bare digit beside the team name: a loose
  // number there reads as "1 what?" — and Rally gives the count a column too.
  { key: 'features', label: 'Features', defaultWidth: 90, minWidth: 70, align: 'right' },
  { key: 'progress', label: 'Complete / Rollup / Estimated', defaultWidth: 220, minWidth: 140 },
  { key: 'capacity', label: 'Capacity', defaultWidth: 130, minWidth: 100, align: 'right' },
  { key: 'actions', label: '', defaultWidth: 60, minWidth: 60, align: 'center' },
]

export type ItemColKey = 'rank' | 'id' | 'name' | 'assignment' | 'progress' | 'estimated'

/**
 * Rally's Items tab: one row per Feature, ranked.
 *
 * `rank` leads because the cutline only means anything in rank order — Rally shows the line
 * only when items are sorted by rank ascending, so the column that establishes that order is
 * the first thing the reader sees.
 *
 * `assignment` is Rally's "Planned Project Assignment": the team(s) this Feature is planned
 * against inside this plan, which is not the same as the Feature's own team.
 */
export const CAPACITY_ITEM_COLUMNS: ColumnSpec<CapacityPlanItem, unknown, ItemColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 70, minWidth: 60, align: 'right' },
  { key: 'id', label: 'ID', defaultWidth: 110, minWidth: 90, locked: true },
  { key: 'name', label: 'Name', defaultWidth: 300, minWidth: 160, locked: true, grow: true },
  { key: 'assignment', label: 'Planned Team Assignment', defaultWidth: 200, minWidth: 140 },
  { key: 'progress', label: 'Complete / Rollup / Estimated', defaultWidth: 220, minWidth: 140 },
  { key: 'estimated', label: 'Estimated', defaultWidth: 130, minWidth: 100, align: 'right' },
]
