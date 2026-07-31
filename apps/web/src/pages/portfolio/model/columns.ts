import { type ColumnSpec } from '@/shared/ui/table'
import { type PortfolioItem } from '@/features/portfolio/api'

export type ColKey =
  | 'id'
  | 'name'
  | 'state'
  | 'release'
  | 'percentDonePoints'
  | 'percentDoneCount'
  | 'project'
  | 'team'
  | 'owner'

/**
 * The Portfolio grid columns — exactly the set BA spec FR-002 names:
 *
 *   > Rank, Type, ID, Name, Release, State, Percent Done By Story Plan Estimate,
 *   > Percent Done By Story Count, Project, Team, Owner
 *
 * `Rank` is the drag gutter and `Type` is the glyph inside the ID cell, so neither is a
 * resizable column of its own; the remaining nine are.
 *
 * Two columns that USED to be here are deliberately gone, because the spec puts them
 * elsewhere and a grid column that no spec asks for is scope leakage:
 *
 * - **Epic** (the parent of a Feature) — absent from FR-002. The parent is already
 *   expressed structurally: an Epic row discloses its child Features, which says the same
 *   thing without spending a column on it. It remains a Detail field.
 * - **Preliminary / Refined Estimate** — Detail right-rail fields only (SRS §5), and
 *   `:283` is explicit that the list shows no generic Progress column. They were briefly
 *   one derived `Estimate` cell here, then two, before the spec settled it. The forecast
 *   they hold is still visible in the list through the two Percent Done columns, which
 *   divide by it.
 *
 * `sortCol` is omitted for the two Percent Done columns on purpose: they are DERIVED
 * server-side from child rollups, so there is no column to sort by and offering it would
 * silently sort by nothing. Sorting is client-side over the loaded set (see `useTableSort`
 * in the page), same as every other list.
 *
 * Project and Team are real columns here, unlike the single-project lists: the Portfolio
 * list can be scoped to one project or opened up to all of them, so a row's project is
 * information rather than a constant.
 */
export const PORTFOLIO_COLUMNS: ColumnSpec<PortfolioItem, unknown, ColKey>[] = [
  // 96 → 112: the disclosure chevron + its gap sit inside this cell, ahead of the type
  // glyph, and at 96 the key itself was the thing that truncated.
  { key: 'id', label: 'ID', defaultWidth: 112, minWidth: 88, locked: true, sortCol: 'itemKey' },
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
  { key: 'release', label: 'Release', defaultWidth: 160, minWidth: 100 },
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
  { key: 'project', label: 'Project', defaultWidth: 150, minWidth: 100, sortCol: 'projectId' },
  { key: 'team', label: 'Team', defaultWidth: 150, minWidth: 100 },
  { key: 'owner', label: 'Owner', defaultWidth: 150, minWidth: 100 },
]
