import { type ColumnSpec } from '@/shared/ui/table'
import type { PortfolioChild, PortfolioItem } from '@/features/portfolio/api'

export type ChildColKey =
  | 'type'
  | 'id'
  | 'name'
  | 'priority'
  | 'estimate'
  | 'owner'
  | 'scheduleState'
  | 'iteration'
  | 'release'

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
export const PORTFOLIO_CHILD_COLUMNS: ColumnSpec<PortfolioChild, unknown, ChildColKey>[] = [
  { key: 'type', label: 'Type', defaultWidth: 56, minWidth: 48, align: 'center' },
  { key: 'id', label: 'ID', defaultWidth: 104, minWidth: 88, locked: true, sortCol: 'itemKey' },
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 260,
    minWidth: 160,
    locked: true,
    grow: true,
    sortCol: 'title',
  },
  { key: 'priority', label: 'Priority', defaultWidth: 96, minWidth: 80, sortCol: 'priority' },
  // `Est` is the BA's label, and the Totals row sums this column — the one number the tab foots.
  { key: 'estimate', label: 'Est', defaultWidth: 72, minWidth: 60, align: 'right', sortCol: 'estimate' },
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
]

export type EpicChildColKey =
  | 'rank'
  | 'id'
  | 'name'
  | 'team'
  | 'state'
  | 'complete'
  | 'rollup'
  | 'estimated'
  | 'owner'

/**
 * An Epic's Children tab: its child FEATURES, with the roll-ups the BA lists.
 *
 * "Shows Rank, ID, Name, Team, State, Complete, Rollup, Estimated and Owner" — a different question
 * from a Feature's children, which are Stories and Defects. An Epic has no children of its own in the
 * story hierarchy, so its numbers are its Features' roll-ups, which is why this column set carries
 * Complete/Rollup/Estimated where the Feature's carries Priority/Iteration.
 */
export const EPIC_CHILD_COLUMNS: ColumnSpec<PortfolioItem, unknown, EpicChildColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 64, minWidth: 56, align: 'right' },
  { key: 'id', label: 'ID', defaultWidth: 104, minWidth: 88, locked: true, sortCol: 'itemKey' },
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 240,
    minWidth: 150,
    locked: true,
    grow: true,
    sortCol: 'name',
  },
  { key: 'team', label: 'Team', defaultWidth: 140, minWidth: 100, sortCol: 'team' },
  { key: 'state', label: 'State', defaultWidth: 150, minWidth: 110, sortCol: 'state' },
  { key: 'complete', label: 'Complete', defaultWidth: 92, minWidth: 76, align: 'right' },
  { key: 'rollup', label: 'Rollup', defaultWidth: 88, minWidth: 72, align: 'right' },
  { key: 'estimated', label: 'Estimated', defaultWidth: 96, minWidth: 80, align: 'right' },
  { key: 'owner', label: 'Owner', defaultWidth: 140, minWidth: 100, sortCol: 'owner' },
]
