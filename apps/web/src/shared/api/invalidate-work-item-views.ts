import type { QueryClient } from '@tanstack/react-query'

/**
 * Query-key roots for every read-model that renders work-item-derived data —
 * fields, schedule/flow state, hours, assignees, links, time logs, etc.
 *
 * Any mutation that writes a work item, task, defect, or time log MUST refresh
 * ALL of these so every surface — Backlog, Work-item detail, Iteration Status,
 * Team Status, Quality, Portfolio, Reports — reflects the change immediately
 * instead of reverting to a stale cache until the user reloads.
 *
 * These are intentionally the literal query-key ROOTS (not feature-key imports)
 * so this module stays in the shared layer with no feature dependency and no
 * import cycle. Each entry MUST match the `all` / root key exported by its
 * feature module; `query-invalidation.integrity.test.ts` guards that contract.
 */
export const WORK_ITEM_VIEW_ROOTS = [
  ['work-items'], // workItemKeys.all — backlog, list, detail, by-key, tasks, task-totals, activity, time-logs, watchers, labels
  ['iteration-status'], // iterationKeys.statusAll — Iteration Status, Iterations, Reports
  ['team-status'], // teamStatusKeys.all — Team Status
  ['quality'], // qualityKeys.all — Quality / Defects
  ['portfolio'], // portfolioKeys.all — Portfolio tree
  ['reports'], // reportingKeys.all — burndown / velocity
  ['child-defects'], // childDefectsKeys.all — child defects under a story
] as const

/**
 * Invalidate every work-item-derived read-model. `invalidateQueries` matches by
 * key prefix, so passing each root refreshes all of that view's cached filters/
 * ids. Only mounted (active) queries refetch; everything else is merely marked
 * stale, so this stays cheap regardless of how many views exist in the cache.
 */
export function invalidateWorkItemViews(qc: QueryClient): void {
  for (const queryKey of WORK_ITEM_VIEW_ROOTS) {
    void qc.invalidateQueries({ queryKey })
  }
}
