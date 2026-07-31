import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SelectionModal } from '@/shared/ui/selection-modal'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import { usePortfolioItems } from '@/features/portfolio/api'
import { useAllocate, type CapacityPlan } from '@/features/capacity-planning/api'

/**
 * Rally's `Add Items`: a checkbox list of the portfolio items eligible for this plan, confirmed with
 * `Add to Plan`.
 *
 * Rally separates two acts that we had merged into one dialog — putting Features ON the plan, and
 * allocating them TO teams. This is the first: the rows land unassigned (or on one team, when opened
 * from that team's list), and assignment happens afterwards in the grid. Merging them made a
 * multi-Feature add into one dialog per Feature, and made "add" and "allocate" the same word.
 *
 * Reuses the shared `SelectionModal` — the same searchable checkbox list milestones use for their
 * projects and the plan uses for its teams. Search covers what Rally's in-dialog `Show Filters`
 * does for a long portfolio list; the picker shows key + name only, so there is nothing for a
 * `Show Fields` to reveal.
 *
 * Features ALREADY on the plan are absent from the list rather than shown ticked: ticking them off
 * would read as a way to remove them, and removal is the item menu's `Remove From Plan` — a
 * different decision with a different confirmation.
 */
export function AddFeaturesModal({
  plan,
  teamId = null,
  teamName,
  onClose,
}: {
  plan: CapacityPlan
  /** Adds straight to this team — Rally's `Add Items to Project Plan`. Null leaves rows unassigned. */
  teamId?: string | null
  /** Names the team in the title, so the two entry points cannot be confused mid-dialog. */
  teamName?: string | null
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const allocate = useAllocate()

  // Features in the plan's own project; the API enforces the same scope on every write.
  const { items: features } = usePortfolioItems({
    type: PortfolioItemType.Feature,
    projectId: plan.projectId,
  })

  const onPlan = useMemo(
    () => new Set(plan.allocations.map((a) => a.portfolioItemId)),
    [plan.allocations],
  )

  const items = useMemo(
    () =>
      features
        .filter((f) => !onPlan.has(f.id))
        .map((f) => ({
          id: f.id,
          name: `${f.itemKey} — ${f.name}`,
          icon: <TypeBadge type="feature" size={16} />,
        })),
    [features, onPlan],
  )

  /**
   * One allocation per ticked Feature, in sequence.
   *
   * Sequential rather than parallel: each write returns the whole plan, and firing them together
   * would race four refetches to decide which snapshot the cache keeps.
   */
  async function add(ids: string[]) {
    for (const portfolioItemId of ids) {
      await allocate.mutateAsync({ id: plan.id, portfolioItemId, teamId })
    }
  }

  return (
    <SelectionModal
      open
      onClose={onClose}
      title={
        teamName == null
          ? t('addFeatures.title')
          : t('addFeatures.titleForTeam', { team: teamName })
      }
      items={items}
      // Nothing is pre-ticked: this dialog only ever ADDS, so a tick means "put this on the plan".
      selectedIds={[]}
      onSave={add}
      confirmLabel={t('addFeatures.confirm')}
      searchPlaceholder={t('addFeatures.searchPlaceholder')}
    />
  )
}
