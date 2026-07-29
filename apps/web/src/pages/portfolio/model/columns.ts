import { type ColumnSpec } from '@/shared/ui/table'
import { type PortfolioItem } from '@/features/portfolio/api'

export type ColKey =
  | 'id'
  | 'name'
  | 'state'
  | 'parent'
  | 'release'
  | 'percentDonePoints'
  | 'percentDoneCount'
  | 'estimate'
  | 'project'
  | 'team'
  | 'owner'

/**
 * The Portfolio grid columns (BA spec §3.1).
 *
 * `sortCol` is omitted for the two Percent Done columns and Estimate on purpose:
 * they are DERIVED server-side from child rollups, so there is no column to sort
 * by and offering it would silently sort by nothing. Sorting is client-side over
 * the loaded set (see `useTableSort` in the page), same as every other list.
 *
 * Project and Team are real columns here, unlike the single-project lists: the
 * Portfolio list is cross-project by design, so a row's project is information
 * rather than a constant.
 */
export const PORTFOLIO_COLUMNS: ColumnSpec<PortfolioItem, unknown, ColKey>[] = [
  { key: 'id', label: 'ID', defaultWidth: 96, minWidth: 72, locked: true, sortCol: 'itemKey' },
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 260,
    minWidth: 140,
    locked: true,
    grow: true,
    sortCol: 'name',
  },
  { key: 'state', label: 'State', defaultWidth: 148, minWidth: 100, sortCol: 'state' },
  // The parent Epic of a Feature. Empty for an Epic — the hierarchy is two levels.
  { key: 'parent', label: 'Epic', defaultWidth: 150, minWidth: 90 },
  { key: 'release', label: 'Release', defaultWidth: 130, minWidth: 90 },
  {
    key: 'percentDonePoints',
    label: '% Done by Est.',
    defaultWidth: 130,
    minWidth: 110,
  },
  {
    key: 'percentDoneCount',
    label: '% Done by Count',
    defaultWidth: 138,
    minWidth: 110,
  },
  { key: 'estimate', label: 'Estimate', defaultWidth: 92, minWidth: 70, align: 'right' },
  { key: 'project', label: 'Project', defaultWidth: 140, minWidth: 90, sortCol: 'projectId' },
  { key: 'team', label: 'Team', defaultWidth: 130, minWidth: 90 },
  { key: 'owner', label: 'Owner', defaultWidth: 130, minWidth: 90 },
]
