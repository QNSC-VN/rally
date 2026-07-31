/** The selectable Releases / Teams for ONE project. */
export interface PortfolioCellOptions {
  releases: { id: string; releaseKey: string | null; name: string }[]
  teams: { id: string; name: string; key: string }[]
}

/**
 * Projects the caller may move an item INTO — workspace-wide, not per-row, because the
 * destination is by definition a different project from the row's own.
 */
export interface ProjectOption {
  id: string
  key: string
  name: string
}

/**
 * The lists a row gets when its project has resolved nothing yet. A frozen shared
 * constant rather than a fresh `{}` per call, so `optionsFor` returns a stable reference
 * and does not re-render every row on every tick.
 */
export const NO_CELL_OPTIONS: PortfolioCellOptions = { releases: [], teams: [] }
