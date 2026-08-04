/**
 * `Rank Highest` / `Rank Lowest` on the backlog's bulk bar — Rally's toolbar rank actions.
 *
 * These are not a convenience over drag; they do something drag CANNOT. The backlog is
 * server-paginated and `handleDragEnd` reorders within the loaded page only, so from page 3 there is
 * no gesture that reaches position 1. Rally documents the same distinction and warns about the trap
 * it creates: "the work item moves to the end of **the list**, not the end of **the page**."
 *
 * Rally's third action, `Move to Position`, is deliberately absent — see `useRankToBacklogEdge` for
 * why the 100-row `limit` cap makes an arbitrary position unreachable on the current contract.
 *
 * Exactly ONE row, mirroring the Portfolio grid's bulk `Edit`: two items sent to the top have no
 * defined order between them, and the neighbour-based rank endpoint would need a sequence of calls
 * whose intermediate states are visible. Rather than invent an order, require the unambiguous case.
 *
 * Hidden entirely while a column sort is active, for the same reason drag is disabled then
 * (`backlog-page.tsx`: "a column sort detaches the visual order from rank"). A control that says
 * "highest" is meaningless when the list is not in rank order, and disabling rather than hiding
 * would leave the reader hunting for a tooltip.
 */
import { useTranslation } from 'react-i18next'
import { ArrowUpToLine, ArrowDownToLine } from 'lucide-react'
import { toast } from 'sonner'

import { BulkActionButton } from '@/shared/ui/bulk-action-bar'
import { type RowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useRankToBacklogEdge, type BacklogFilters } from '@/features/work-items/api'

export function RankEdgeActions({
  selection,
  projectId,
  filters,
  sorted,
}: {
  selection: RowSelection
  projectId: string | undefined
  /**
   * The grid's live filters, forwarded so "the list" means the one on screen.
   *
   * Without them `Rank Lowest` would send the item below rows the user has filtered out — a move
   * they cannot see and did not ask for.
   */
  filters: Omit<BacklogFilters, 'sort' | 'limit' | 'cursor'>
  /** True while a column sort is active. */
  sorted: boolean
}) {
  const { t } = useTranslation('backlog')
  const rankToEdge = useRankToBacklogEdge(projectId)

  if (sorted) return null

  const only = selection.count === 1 ? [...selection.selectedIds][0] : undefined

  function send(edge: 'top' | 'bottom') {
    if (!only) return
    rankToEdge.mutate(
      { id: only, edge, filters },
      {
        onSuccess: (item) => {
          // `null` means the item was already at that edge. Say so rather than reporting a move
          // that did not happen — the rows do not visibly change either way.
          toast.success(item ? t('rank.moved') : t('rank.alreadyThere'))
          selection.clear()
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  const disabled = !only || rankToEdge.isPending
  const oneOnly = only ? undefined : t('rank.oneOnly')

  return (
    <>
      <BulkActionButton
        label={t('rank.highest')}
        icon={<ArrowUpToLine size={12} />}
        disabled={disabled}
        title={oneOnly}
        onClick={() => send('top')}
      />
      <BulkActionButton
        label={t('rank.lowest')}
        icon={<ArrowDownToLine size={12} />}
        disabled={disabled}
        title={oneOnly}
        onClick={() => send('bottom')}
      />
    </>
  )
}
