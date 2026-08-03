import { rankColumn, type ColumnSpec } from '@/shared/ui/table'
import type { PortfolioChild, PortfolioItem } from '@/features/portfolio/api'

export type ChildColKey =
  | 'rank'
  | 'id'
  | 'name'
  | 'priority'
  | 'estimate'
  | 'owner'
  | 'scheduleState'
  | 'iteration'
  | 'release'
  | 'taskEstimate'
  | 'toDo'
  | 'actual'

/**
 * A Feature's Children tab — the BA's column list, in its order.
 *
 * "Type, ID, Name, ..., Priority, ..., Est, ..., Owner, ..., Schedule State, ..., Iteration, Release"
 * (`01_Portfolio_Items/SRS.md`). The tab was a flat run of `<div>`s carrying ID, name and state, so
 * six of these nine columns had nowhere to render — and `priority` / `iterationName` were not even on
 * the wire until this slice added them.
 *
 * A REAL grid rather than a bespoke list: this is the Backlog's own shape, and the BA asks for it by
 * that name, so it uses the same `useDataTable` + `DataTableFrame` + `TableTotalsRow` every other grid
 * in the app does. That is what makes the columns resizable, reorderable and sortable without any of
 * it being written here.
 */
/**
 * No `Type` column. The ID cell already carries the type as its badge glyph — the same
 * `TypeBadge` a dedicated column would have rendered — so the column repeated one field twice in
 * adjacent cells. Backlog and Iteration Status both show type through the ID cell alone.
 */
export const PORTFOLIO_CHILD_COLUMNS: ColumnSpec<PortfolioChild, unknown, ChildColKey>[] = [
  // Rank first, from the shared definition — the rows arrive in `workItems.rank` order and can be
  // dragged, so the reader needs to see the position they are changing.
  rankColumn(),
  { key: 'id', label: 'ID', defaultWidth: 104, minWidth: 88, locked: true, sortCol: 'itemKey' },
  /**
   * NOT `grow: true`, deliberately — the same choice Iteration Status and the Backlog make for
   * their Name columns.
   *
   * `styleFor` gives a grow column `minWidth: <its current width>` as a floor it may expand past.
   * Paired with the row's `min-w-max`, that floor means the TABLE widens to fit a long title
   * instead of the title wrapping inside its cell: 260px of minimum, and text that never breaks.
   * A plain fixed-width column gets a real width, so `break-words` in the cell can do its job.
   */
  { key: 'name', label: 'Name', defaultWidth: 260, minWidth: 160, locked: true, sortCol: 'title' },
  { key: 'priority', label: 'Priority', defaultWidth: 96, minWidth: 80, sortCol: 'priority' },
  // `Est` is the BA's label for the Story/Defect Plan Estimate — points, not hours. The three
  // hour columns below belong to Tasks and are a different measure entirely.
  {
    key: 'estimate',
    label: 'Est',
    defaultWidth: 72,
    minWidth: 60,
    align: 'right',
    sortCol: 'estimate',
  },
  { key: 'owner', label: 'Owner', defaultWidth: 140, minWidth: 100, sortCol: 'owner' },
  {
    key: 'scheduleState',
    label: 'Schedule State',
    defaultWidth: 140,
    minWidth: 110,
    sortCol: 'scheduleState',
  },
  { key: 'iteration', label: 'Iteration', defaultWidth: 140, minWidth: 100, sortCol: 'iteration' },
  { key: 'release', label: 'Release', defaultWidth: 150, minWidth: 110, sortCol: 'release' },
  /**
   * The three Task-hour columns, labelled and sized as Iteration Status labels and sizes them.
   *
   * They are blank on a Story/Defect row and carry values on its disclosed Tasks: hours live on
   * Tasks in this product, which is exactly why Iteration Status shows the same three beside
   * `Plan Estimate` rather than folding them into one cell. The disclosed rows previously packed
   * both numbers into a single `To Do 3h · Actual 5h` string in a column that named neither.
   */
  { key: 'taskEstimate', label: 'Task Est', defaultWidth: 80, minWidth: 68, align: 'right' },
  { key: 'toDo', label: 'To Do', defaultWidth: 70, minWidth: 60, align: 'right' },
  { key: 'actual', label: 'Actual', defaultWidth: 70, minWidth: 60, align: 'right' },
]

export type EpicChildColKey =
  'rank' | 'id' | 'name' | 'team' | 'state' | 'complete' | 'rollup' | 'estimated' | 'owner'

/**
 * An Epic's Children tab: its child FEATURES, with the roll-ups the BA lists.
 *
 * "Shows Rank, ID, Name, Team, State, Complete, Rollup, Estimated and Owner" — a different question
 * from a Feature's children, which are Stories and Defects. An Epic has no children of its own in the
 * story hierarchy, so its numbers are its Features' roll-ups, which is why this column set carries
 * Complete/Rollup/Estimated where the Feature's carries Priority/Iteration.
 */
export const EPIC_CHILD_COLUMNS: ColumnSpec<PortfolioItem, unknown, EpicChildColKey>[] = [
  rankColumn(),
  { key: 'id', label: 'ID', defaultWidth: 104, minWidth: 88, locked: true, sortCol: 'itemKey' },
  // Fixed width, not `grow` — see the note on the Feature tab's Name column above: a grow column
  // gets a minWidth floor and no ceiling, so a long title widens the table instead of wrapping.
  { key: 'name', label: 'Name', defaultWidth: 240, minWidth: 150, locked: true, sortCol: 'name' },
  { key: 'team', label: 'Team', defaultWidth: 140, minWidth: 100, sortCol: 'team' },
  { key: 'state', label: 'State', defaultWidth: 150, minWidth: 110, sortCol: 'state' },
  { key: 'complete', label: 'Complete', defaultWidth: 92, minWidth: 76, align: 'right' },
  { key: 'rollup', label: 'Rollup', defaultWidth: 88, minWidth: 72, align: 'right' },
  { key: 'estimated', label: 'Estimated', defaultWidth: 96, minWidth: 80, align: 'right' },
  { key: 'owner', label: 'Owner', defaultWidth: 140, minWidth: 100, sortCol: 'owner' },
]
