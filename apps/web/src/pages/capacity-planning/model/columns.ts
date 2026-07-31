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

export type TeamColKey =
  'team' | 'features' | 'progress' | 'complete' | 'rollup' | 'estimated' | 'capacity' | 'actions'

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
    defaultWidth: 240,
    minWidth: 160,
    locked: true,
    grow: true,
  },
  // Its own column, with a header, rather than a bare digit beside the team name: a loose
  // number there reads as "1 what?" — and Rally gives the count a column too.
  { key: 'features', label: 'Features', defaultWidth: 84, minWidth: 70, align: 'right' },
  // The bar is UNLABELLED and sits beside the numbers, not instead of them. Rally shows both: the
  // bar answers "is this team over?" at a glance, the numbers answer "by how much" — and an
  // earlier version of this grid collapsed all three values into the bar, so the numbers could
  // only be read by hovering.
  { key: 'progress', label: '', defaultWidth: 170, minWidth: 120 },
  // Four NARROW numeric columns, not four comfortable ones. Eight columns plus the open Details
  // panel is ~980px of usable width; at the 110px each of these first had, Capacity — the baseline
  // every other number is a percentage of — fell off the right edge entirely. Each holds
  // `value + small %`, so ~84px is enough for the four digits Rally shows.
  {
    key: 'complete',
    label: 'Complete',
    defaultWidth: 88,
    minWidth: 74,
    align: 'right',
    sortCol: 'complete',
  },
  {
    key: 'rollup',
    label: 'Rollup',
    defaultWidth: 84,
    minWidth: 70,
    align: 'right',
    sortCol: 'rollup',
  },
  {
    key: 'estimated',
    label: 'Estimated',
    defaultWidth: 88,
    minWidth: 74,
    align: 'right',
    sortCol: 'estimated',
  },
  {
    key: 'capacity',
    label: 'Capacity',
    defaultWidth: 100,
    minWidth: 84,
    align: 'right',
    sortCol: 'capacity',
  },
  { key: 'actions', label: '', defaultWidth: 48, minWidth: 48, align: 'center' },
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
  { key: 'id', label: 'ID', defaultWidth: 100, minWidth: 90, locked: true },
  // Widths sized so the LAST column still lands inside the ~980px the main pane has with Details
  // open — `grow` only spends surplus width, it does not claw any back, so defaults that overflow
  // simply push the right-hand columns out of sight.
  { key: 'name', label: 'Name', defaultWidth: 220, minWidth: 160, locked: true, grow: true },
  { key: 'assignment', label: 'Planned Team Assignment', defaultWidth: 170, minWidth: 140 },
  { key: 'progress', label: 'Complete / Rollup / Estimated', defaultWidth: 180, minWidth: 140 },
  { key: 'estimated', label: 'Estimated', defaultWidth: 100, minWidth: 90, align: 'right' },
]
