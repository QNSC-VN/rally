import { useTranslation } from 'react-i18next'

import { notify } from '@/shared/lib/toast'
import {
  useAllocate,
  useRemoveAllocation,
  useUpdateAllocation,
  type CapacityAllocation,
  type CapacityPlan,
  type CapacityPlanItem,
} from './api'

/** The three verbs plus the gear resolver, ready to hand to a row. */
export interface PlanItemActions {
  /** Rally's `Remove From Plan`: drop every allocation of the Feature. */
  removeFeature: (item: { portfolioItemId: string; itemKey: string }) => Promise<void>
  /** Rally's inline Planned Team Assignment: one team, or none. */
  assignFeature: (item: CapacityPlanItem, teamId: string | null) => Promise<void>
  /** Rally's `Remove All Assignments`: keep the Feature, empty its teams. */
  unassignFeature: (item: { portfolioItemId: string; itemKey: string }) => Promise<void>
  /**
   * Props for the shared item gear on a nested (Teams-tab) row.
   *
   * `undefined` when the reader cannot manage the plan, which is what hides the gear rather than
   * letting it offer verbs the API refuses.
   */
  itemActionsFor?: (allocation: CapacityAllocation) => {
    hasTeams: boolean
    onAllocate: () => void
    onMove: () => void
    onUnassign: () => void
    onRemove: () => void
  }
}

/**
 * The Feature-level writes a capacity plan's grids share.
 *
 * Lifted out of the detail page because BOTH tabs perform them — the Features grid from its own
 * rows, the Teams grid from a team's sub-table — and the page was the only thing holding them
 * together. Keeping one definition is what stops `Remove From Plan` meaning one thing under a team
 * and another on the Features tab; it also kept the page under the file-length ratchet.
 *
 * Every verb is expressed in ALLOCATION rows rather than in a single call, because that is how the
 * plan models a Feature: it is on the plan precisely because those rows exist.
 */
export function usePlanItemActions({
  plan,
  planId,
  canManage,
  onAllocate,
  onMove,
}: {
  /** The loaded plan, or undefined while it is still in flight. */
  plan: CapacityPlan | undefined
  planId: string
  canManage: boolean
  /** Opens the Allocate dialog for a Feature — the page owns the modal state. */
  onAllocate: (portfolioItemId: string) => void
  /** Opens `Move To Another Plan` for a Feature. */
  onMove: (portfolioItemId: string) => void
}): PlanItemActions {
  const { t } = useTranslation('capacity')
  const allocate = useAllocate()
  const updateAllocation = useUpdateAllocation()
  const removeAllocation = useRemoveAllocation()

  const rowsFor = (portfolioItemId: string) =>
    (plan?.allocations ?? []).filter((a) => a.portfolioItemId === portfolioItemId)

  /**
   * Rally's `Remove From Plan`: takes a Feature off the plan.
   *
   * Deletes every allocation of it, across teams and the Unallocated bucket. The Feature itself is
   * untouched — this is a planning decision, not a portfolio one.
   */
  async function removeFeature(item: { portfolioItemId: string; itemKey: string }) {
    try {
      for (const row of rowsFor(item.portfolioItemId)) {
        await removeAllocation.mutateAsync({ id: planId, allocationId: row.id })
      }
      notify.success(t('items.removed', { item: item.itemKey }))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('row.allocationRemoveFailed'))
    }
  }

  /**
   * Rally's inline assignment: one team, or none.
   *
   * `null` unassigns — the only way back to the yellow unassigned state. A Feature with an existing
   * team row MOVES it (the API's `teamId` patch); one with none gets a fresh allocation, which the
   * service then consumes from the parked row.
   */
  async function assignFeature(item: CapacityPlanItem, teamId: string | null) {
    const rows = rowsFor(item.portfolioItemId)
    try {
      if (rows.length === 0) {
        await allocate.mutateAsync({ id: planId, portfolioItemId: item.portfolioItemId, teamId })
      } else {
        await updateAllocation.mutateAsync({ id: planId, allocationId: rows[0].id, teamId })
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('items.assignFailed'))
    }
  }

  /**
   * Rally's `Remove All Assignments`: the Feature stays on the plan, its teams do not.
   *
   * One row survives, moved to the Unallocated bucket, and the rest are deleted — the plan holds a
   * Feature THROUGH its allocation rows, so removing every row would remove the Feature too, which
   * is the other verb. Keeping the first and clearing its team is the shortest path to "still
   * planned, not yet assigned".
   */
  async function unassignFeature(item: { portfolioItemId: string; itemKey: string }) {
    const rows = rowsFor(item.portfolioItemId).filter((a) => a.teamId !== null)
    if (rows.length === 0) return
    const [keep, ...drop] = rows
    try {
      await updateAllocation.mutateAsync({ id: planId, allocationId: keep.id, teamId: null })
      for (const row of drop) {
        await removeAllocation.mutateAsync({ id: planId, allocationId: row.id })
      }
      notify.success(t('items.assignmentsCleared', { item: item.itemKey }))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('row.allocationRemoveFailed'))
    }
  }

  return {
    removeFeature,
    assignFeature,
    unassignFeature,
    itemActionsFor: canManage
      ? (allocation: CapacityAllocation) => {
          const item = {
            portfolioItemId: allocation.portfolioItemId,
            itemKey: allocation.itemKey,
          }
          return {
            hasTeams: rowsFor(allocation.portfolioItemId).some((a) => a.teamId !== null),
            onAllocate: () => onAllocate(allocation.portfolioItemId),
            onMove: () => onMove(allocation.portfolioItemId),
            onUnassign: () => void unassignFeature(item),
            onRemove: () => void removeFeature(item),
          }
        }
      : undefined,
  }
}
