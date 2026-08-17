/** The selectable Releases / Teams for ONE project. */
export interface PortfolioCellOptions {
  releases: { id: string; releaseKey: string | null; name: string }[]
  teams: { id: string; name: string; key: string }[]
}

/**
 * There is no `ProjectOption` here any more.
 *
 * It was "projects the caller may move an item INTO — workspace-wide, because the destination is by
 * definition a different project from the row's own". §3.1 makes Project read-only for both types,
 * so there is no move and no destination list; the grid needs only a `projectId → key` lookup for
 * the chip, which the page supplies as `projectKeyFor`.
 */

/**
 * The lists a row gets when its project has resolved nothing yet. A frozen shared
 * constant rather than a fresh `{}` per call, so `optionsFor` returns a stable reference
 * and does not re-render every row on every tick.
 */
export const NO_CELL_OPTIONS: PortfolioCellOptions = { releases: [], teams: [] }
