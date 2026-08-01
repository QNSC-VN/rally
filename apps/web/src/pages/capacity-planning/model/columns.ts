import { type ColumnSpec } from '@/shared/ui/table'
import {
  type CapacityAllocation,
  type CapacityPlan,
  type CapacityPlanItem,
  type CapacityPlanTeam,
} from '@/features/capacity-planning/api'

export type PlanColKey = 'id' | 'name' | 'release' | 'status' | 'updatedAt' | 'teamCount'

/**
 * The capacity-plans list — Rally's columns, and ONLY Rally's: ID, Name, Release, Status, Last
 * Updated, then the count of teams in the plan (Rally labels it "Projects in Plan"; we keep the team
 * vocabulary).
 *
 * Unit, Target Load and Capacity are deliberately absent. They are plan SETTINGS, not a way to tell
 * two plans apart: the unit is fixed at creation, target load is one advisory number a planner rarely
 * changes, and a total capacity means nothing until you are inside the plan looking at which team it
 * belongs to. All three live on the detail page, where they are actionable.
 *
 * `teamCount` has no `sortCol`: it is derived on read from the plan's team rows, so there is no
 * column for a server sort to name. Sorting is client-side here anyway — the list is bounded by a
 * project's releases — but a `sortCol` on a derived field would still claim something the API does
 * not honour.
 */
export const CAPACITY_PLAN_COLUMNS: ColumnSpec<CapacityPlan, unknown, PlanColKey>[] = [
  { key: 'id', label: 'ID', defaultWidth: 92, minWidth: 70, locked: true },
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 260,
    minWidth: 140,
    locked: true,
    grow: true,
    sortCol: 'name',
  },
  // Wide enough for `RE-<n>: Name` plus the glyph — the shared release cell shows the key too,
  // and at 180px the name truncated on the seeded data alone.
  { key: 'release', label: 'Release', defaultWidth: 230, minWidth: 120 },
  { key: 'status', label: 'Status', defaultWidth: 110, minWidth: 80, sortCol: 'status' },
  {
    key: 'updatedAt',
    label: 'Last Updated',
    defaultWidth: 150,
    minWidth: 110,
    sortCol: 'updatedAt',
  },
  { key: 'teamCount', label: 'Teams in Plan', defaultWidth: 110, minWidth: 90, align: 'right' },
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
  {
    key: 'features',
    label: 'Features',
    defaultWidth: 84,
    minWidth: 70,
    align: 'right',
    sortCol: 'features',
  },
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

export type ItemColKey =
  | 'marker'
  | 'rank'
  | 'id'
  | 'name'
  | 'assignment'
  | 'project'
  | 'dependencies'
  | 'rollup'
  | 'estimated'
  | 'complete'
  | 'actions'

/**
 * Rally's Features tab: one row per Feature, ranked, with its allocations nested underneath.
 *
 * `rank` leads because the cutline only means anything in rank order — Rally draws the line only
 * when items are sorted by rank ascending, so the column that establishes that order comes first.
 *
 * `project` is the Feature's OWN project ("current assignment outside the plan" in Rally's words),
 * which is not the same as `assignment` — Rally's "Planned Project Assignment", the team this
 * Feature is planned against INSIDE this plan. A Story-to-Feature link may cross projects, so the
 * two genuinely differ and Rally shows both.
 *
 * Three numeric columns rather than one bar: Rally puts no bar on this tab. A Feature has no
 * capacity of its own, so there is no baseline to draw against — the bar on the team grid means
 * "against this team's ceiling", and the same shape here would imply a ceiling that does not exist.
 *
 * ORDER is Rally's, left to right: the change marker, Rank, ID, Name, Planned Project Assignment,
 * Project, Dependencies, then Rollup → Estimated → Complete. The numeric three used to run
 * Complete-first, which inverted Rally's reading order — total, then what is planned, then what is
 * done.
 *
 * EVERY column that carries a value is sortable, because Rally sorts every one of them here — it even
 * sorts `+/-`, "to group the added and removed portfolio items together", which is the one sort we
 * cannot offer until the marker means something. The cutline and the drag grip are defined ONLY in
 * rank-ascending order, so both disappear under any other sort; `isRankOrder` is the single predicate
 * for that.
 *
 * `marker` and `dependencies` are RESERVED, and deliberately so. The BA's catalog keeps both as
 * placeholders "for Rally visual parity": the marker is neutral until a publication snapshot exists
 * to diff against, and Dependencies shows a zero until there is a dependency model to count. A
 * column that appears later shifts every other one; a column that is present and empty does not.
 */
export const CAPACITY_ITEM_COLUMNS: ColumnSpec<CapacityPlanItem, unknown, ItemColKey>[] = [
  // Rally's `+/-`: green `+` for a Feature added after publication, red `-` for one removed. Empty
  // until a plan carries a published snapshot to diff against — the BA calls it "neutral before
  // Publish", which is every plan today.
  { key: 'marker', label: '', defaultWidth: 24, minWidth: 24, align: 'center' },
  { key: 'rank', label: 'Rank', defaultWidth: 66, minWidth: 56, align: 'right', sortCol: 'rank' },
  { key: 'id', label: 'ID', defaultWidth: 92, minWidth: 84, locked: true, sortCol: 'itemKey' },
  // Sized for the ~1010px this tab has once the Team Capacity rail takes its 256: `grow` spends
  // surplus but never claws width back, so defaults that overflow simply hide the last column.
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 150,
    minWidth: 130,
    locked: true,
    grow: true,
    sortCol: 'name',
  },
  {
    key: 'assignment',
    label: 'Planned Team Assignment',
    defaultWidth: 150,
    minWidth: 130,
    sortCol: 'assignment',
  },
  { key: 'project', label: 'Project', defaultWidth: 96, minWidth: 84, sortCol: 'project' },
  // Placeholder, per the BA: "It shows `0` until dependency modelling is added."
  {
    key: 'dependencies',
    label: 'Dependencies',
    defaultWidth: 118,
    minWidth: 100,
    align: 'right',
    sortCol: 'dependencies',
  },
  {
    key: 'rollup',
    label: 'Rollup',
    defaultWidth: 82,
    minWidth: 70,
    align: 'right',
    sortCol: 'rollup',
  },
  {
    key: 'estimated',
    label: 'Estimated',
    defaultWidth: 96,
    minWidth: 84,
    align: 'right',
    sortCol: 'estimated',
  },
  {
    key: 'complete',
    label: 'Complete',
    defaultWidth: 88,
    minWidth: 74,
    align: 'right',
    sortCol: 'complete',
  },
  // Rally's per-item menu lives here — `Remove From Plan` takes a Feature off the plan. This is the
  // ONLY place a Feature leaves a plan: the team sub-table has no trash, because removing a Feature
  // is a decision about the plan, not about one team's slice of it.
  { key: 'actions', label: '', defaultWidth: 44, minWidth: 44, align: 'center' },
]

export type AllocColKey =
  | 'actions'
  | 'rank'
  | 'id'
  | 'name'
  | 'state'
  | 'allocation'
  | 'dependencies'
  | 'progress'
  | 'complete'
  | 'rollup'
  | 'estimated'
  | 'tier'

/**
 * The SUB-TABLE under an expanded team: the Features allocated to it, with its own header row.
 *
 * Rally nests a real table here rather than continuing the parent's columns, and the reason is that
 * the two grids report different things. The parent's `Features` column is a count, its `Capacity`
 * is a ceiling a planner typed; a child row has neither — it has an `Allocation`, the slice of that
 * ceiling this Feature was promised. Reusing the parent's headers made a child's allocation sit
 * under a header that said "Capacity", which is a different number.
 *
 * Column set follows the BA's catalog for this table, left to right: the row's gear, `Rank`, `ID`,
 * `Name`, `State`, `Allocation`, `Dependencies`, the bar, `Complete`, `Rollup`, `Estimated`. The
 * gear LEADS here — "Draft-only gear icon at the start of the row, and the only place this row's
 * allocation is changed" — which is the one place it does not sit last, because on this table it is
 * the row's subject rather than an afterthought. `Rank` and `State` belong to the FEATURE, not to the
 * allocation: a planner reading one team's list still wants the plan-wide priority and where the
 * Feature has got to.
 *
 * Widths sum to ~1030px so the nested table fits inside the indented container without its own
 * horizontal scrollbar: a scrollbar inside a scrollable page reads as a broken layout, and the
 * columns here are all short values.
 *
 * Same `useDataTable` + `DataTableFrame` as every other grid, so the nested table resizes, reorders
 * and scrolls exactly like the one above it.
 */
export const CAPACITY_ALLOCATION_COLUMNS: ColumnSpec<CapacityAllocation, unknown, AllocColKey>[] = [
  { key: 'actions', label: '', defaultWidth: 40, minWidth: 40, align: 'center' },
  { key: 'rank', label: 'Rank', defaultWidth: 60, minWidth: 52, align: 'right' },
  { key: 'id', label: 'ID', defaultWidth: 92, minWidth: 80, locked: true },
  { key: 'name', label: 'Name', defaultWidth: 176, minWidth: 130, locked: true, grow: true },
  { key: 'state', label: 'State', defaultWidth: 112, minWidth: 90 },
  // Where this row's work came FROM: `—` on the Feature's owning team, `From {owner}` on any other.
  { key: 'allocation', label: 'Allocation', defaultWidth: 124, minWidth: 90 },
  // Placeholder, per the BA: "every row shows `—`" until there is a dependency model.
  // The label is the widest thing in this column, so the width is set by it, not by the `—`/`0`.
  { key: 'dependencies', label: 'Dependencies', defaultWidth: 124, minWidth: 104, align: 'right' },
  { key: 'progress', label: '', defaultWidth: 130, minWidth: 100 },
  { key: 'complete', label: 'Complete', defaultWidth: 86, minWidth: 72, align: 'right' },
  { key: 'rollup', label: 'Rollup', defaultWidth: 80, minWidth: 68, align: 'right' },
  { key: 'estimated', label: 'Estimated', defaultWidth: 86, minWidth: 72, align: 'right' },
  // The ESTIMATE glyph — which tier the Estimated figure came from.
  { key: 'tier', label: '', defaultWidth: 40, minWidth: 40, align: 'center' },
]
