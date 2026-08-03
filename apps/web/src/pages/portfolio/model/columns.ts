import { rankColumn, type ColumnSpec } from '@/shared/ui/table'
import { type PortfolioItem } from '@/features/portfolio/api'
import { PORTFOLIO_STATES } from './portfolio-states'

export type ColKey =
  | 'rank'
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
 * `Type` is the glyph inside the ID cell rather than a column of its own. `Rank` IS a column, and
 * carries the up/down controls: §37 makes it "up/down reorder buttons only, no drag-and-drop", and §14
 * lists drag under Not included. It used to be the drag gutter, which put the one gesture the BA
 * excludes in place of the two it asks for.
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
 * EVERY column is sortable, which is what §55 asks for ("Every column is resizable … and sortable").
 * Five were not: Release, Team, Owner and both Percent Done columns had no `sortCol`, so their headers
 * offered nothing — and Project's was `projectId`, a uuidv7, so clicking it ordered rows by when their
 * project was created rather than by the name in the cell.
 *
 * Each `sortCol` is now the column's own KEY and {@link portfolioSortValue} maps it to a comparable
 * value. One place to look, and derived columns (the two ratios) become sortable client-side over the
 * loaded set — the whole list is in hand, so "derived server-side" was never a reason not to.
 *
 * Project and Team are real columns here, unlike the single-project lists: the Portfolio
 * list can be scoped to one project or opened up to all of them, so a row's project is
 * information rather than a constant.
 */
export const PORTFOLIO_COLUMNS: ColumnSpec<PortfolioItem, unknown, ColKey>[] = [
  /**
   * Wider than the shared 60px default, because this cell holds the number AND two reorder buttons.
   *
   * `sortCol: 'rank'` comes from the shared spec: §273 requires the order to persist "across a
   * Rank-column sort", and sorting by rank is how a planner returns to it after sorting by something
   * else — which is also the only state in which the buttons can act.
   */
  { ...rankColumn(), defaultWidth: 96, minWidth: 88 },
  /**
   * 132/120 — the SAME as Iteration Status' ID column, deliberately.
   *
   * That grid has the identical structure in this cell (disclosure chevron, then the type
   * glyph, then the key), so matching it is a reason rather than a guess. Was 96, which
   * truncated the key itself; then 112, which still wrapped a long key onto three lines.
   */
  { key: 'id', label: 'ID', defaultWidth: 132, minWidth: 120, locked: true, sortCol: 'id' },
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
  { key: 'release', label: 'Release', defaultWidth: 160, minWidth: 100, sortCol: 'release' },
  {
    key: 'percentDonePoints',
    label: '% Done by Est.',
    defaultWidth: 130,
    minWidth: 110,
    sortCol: 'percentDonePoints',
  },
  {
    key: 'percentDoneCount',
    label: '% Done by Count',
    defaultWidth: 138,
    minWidth: 110,
    sortCol: 'percentDoneCount',
  },
  { key: 'project', label: 'Project', defaultWidth: 150, minWidth: 100, sortCol: 'project' },
  { key: 'team', label: 'Team', defaultWidth: 150, minWidth: 100, sortCol: 'team' },
  { key: 'owner', label: 'Owner', defaultWidth: 150, minWidth: 100, sortCol: 'owner' },
]

/**
 * The comparable value behind each sortable column.
 *
 * The page used to index the row by the sort key (`item[sortField]`), which worked only where a column
 * key happened to name a scalar field: `project` sorted by `projectId` — a uuidv7, so by creation time —
 * and anything nested or derived could not be expressed at all.
 *
 * Three rules the generic lookup could not carry:
 *
 * - **State sorts by LIFECYCLE position**, not alphabetically. `PORTFOLIO_STATES` is in the BA's order,
 *   so `Developing` belongs after `Discovering` rather than before `Discovering`'s letter D-i-s.
 * - **Names sort case-insensitively.** Raw `<` puts every capital before every lowercase letter, so a
 *   list of names read as two interleaved lists.
 * - **An absent value sorts as absent**, not as 0: a Feature with no linked children has no Percent
 *   Done, and `-1` keeps it away from a genuine 0%, which means "nothing accepted yet".
 */
export function portfolioSortValue(item: PortfolioItem, key: string): string | number {
  switch (key) {
    case 'rank':
      // LexoRank, which sorts as text BY DESIGN — that is the stored order the grid opens in.
      return item.rank
    case 'id':
      return item.itemKey
    case 'name':
      return item.name.toLowerCase()
    case 'state': {
      const at = PORTFOLIO_STATES.indexOf(item.state)
      return at === -1 ? PORTFOLIO_STATES.length : at
    }
    case 'release':
      return item.releaseName?.toLowerCase() ?? ''
    case 'percentDonePoints':
      return item.progress.percentDoneByPlanEstimate ?? -1
    case 'percentDoneCount':
      return item.progress.percentDoneByCount ?? -1
    case 'project':
      return item.projectName?.toLowerCase() ?? ''
    case 'team':
      return item.teamName?.toLowerCase() ?? ''
    case 'owner':
      return item.ownerName?.toLowerCase() ?? ''
    default:
      return ''
  }
}
