import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { SearchInput } from '@/shared/ui/search-input'
import { SelectionCheckbox } from '@/shared/ui/selection-checkbox'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/empty-state'
import { notify } from '@/shared/lib/toast'
import { CAPACITY_STATUS_STYLE } from '@/features/capacity-planning/status-colors'
import {
  useCapacityPlans,
  useMoveItemToPlan,
  type CapacityPlan,
} from '@/features/capacity-planning/api'

/**
 * Rally's `Move To Another Plan`: relocate one Feature's planning to a different plan.
 *
 * Rally's own dialog, control for control — "Use the Search plans field to search for a plan by
 * name", an `Update the Release to match the selected plan` checkbox, and two buttons: `Move`, plus
 * `Move and Republish the Plan` when the target is published, because "if the new plan is in a
 * Published state, moving this item unpublishes the plan".
 *
 * ELIGIBLE plans are this project's, minus this one. A plan is per (project, release) and an
 * allocation is only valid inside the plan's project, so a cross-project target would create a row
 * the next write refuses. Rally also offers `Show Filters` here; search covers the same ground for a
 * list bounded by a project's releases, and a filter over one column of plan names would be a
 * second way to type the same thing.
 *
 * The release checkbox is not decoration: a Feature committed to another release cannot be planned
 * against this one, so a move between releases either updates the Feature's Release or is refused by
 * the API. The dialog says which it will be BEFORE the click, rather than reporting it after.
 */
export function MoveToPlanModal({
  plan,
  portfolioItemId,
  itemKey,
  itemReleaseId,
  onClose,
}: {
  /** The plan being moved FROM. */
  plan: CapacityPlan
  portfolioItemId: string
  /** `FE-3` — stated in the title, since this dialog opens from that row's gear. */
  itemKey: string
  /**
   * The Feature's OWN release, which decides whether the checkbox matters.
   *
   * Passed in rather than looked up: the page already has the plan's item list, and a second fetch
   * here would let the dialog and the grid disagree about the row that was clicked.
   */
  itemReleaseId: string | null
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const move = useMoveItemToPlan()
  // Every plan in the project — the list is bounded by the project's releases, so it arrives whole
  // rather than paged, and the same query the list page already caches serves it.
  const { data: plans = [] } = useCapacityPlans(plan.projectId)

  const [search, setSearch] = useState('')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [updateRelease, setUpdateRelease] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eligible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return plans
      .filter((candidate) => candidate.id !== plan.id)
      /**
       * DRAFTS only. Moving into a published plan unpublishes it — Rally says so, and our API does it —
       * but the BA's Invariant 8 is that "Published Plans are read-only until Revert to Draft". Offering
       * one as a destination invited a planner to unpublish a plan as a side effect of moving a Feature,
       * which is not a decision this dialog is for. Revert the target first, then move.
       */
      .filter((candidate) => candidate.status === 'draft')
      .filter(
        (candidate) =>
          needle === '' ||
          candidate.name.toLowerCase().includes(needle) ||
          (candidate.planKey ?? '').toLowerCase().includes(needle),
      )
  }, [plans, plan.id, search])

  const target = eligible.find((candidate) => candidate.id === targetId) ?? null

  /**
   * Whether moving there means moving the Feature's Release too.
   *
   * Only when the Feature HAS a release and it is not the target's: an unscheduled Feature is
   * eligible for any plan, which is the same rule the allocation guard applies.
   */
  const releaseWouldMove =
    target !== null && itemReleaseId !== null && itemReleaseId !== target.releaseId

  async function run(republish: boolean) {
    if (target === null) {
      setError(t('move.pickPlan'))
      return
    }
    setError(null)
    try {
      const result = await move.mutateAsync({
        id: plan.id,
        portfolioItemId,
        targetPlanId: target.id,
        updateRelease,
        republish,
      })
      // Names what actually happened rather than "Moved": demand can arrive on the target with no
      // team, which is a state the planner has to go and resolve there.
      notify.success(
        result.parked > 0
          ? t('move.movedParked', { item: itemKey, plan: result.targetPlanKey ?? '' })
          : t('move.moved', { item: itemKey, plan: result.targetPlanKey ?? '' }),
      )
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('move.failed')
      setError(message)
      notify.error(message)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('move.title')} width={520}>
      <ModalBody className="space-y-3">
        {error !== null && (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        )}

        <div>
          <p className="text-ui-xs font-semibold text-muted-foreground">{t('move.itemLabel')}</p>
          <p className="text-ui-md text-foreground">{itemKey}</p>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          ariaLabel={t('move.searchPlans')}
          placeholder={t('move.searchPlans')}
          className="w-full"
        />

        {/* One target, so the rows are radios in behaviour even though they wear the app's shared
            checkbox: Rally moves an item to ONE plan, and a multi-select would ask a question with
            no valid second answer. */}
        <div className="max-h-64 divide-y divide-border-inner overflow-y-auto rounded-sm border border-border-inner">
          {eligible.length === 0 ? (
            <EmptyState title={t('move.noPlans')} />
          ) : (
            eligible.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-ui-sm hover:bg-surface-subtle"
              >
                <SelectionCheckbox
                  checked={targetId === candidate.id}
                  onChange={() => setTargetId(candidate.id)}
                  ariaLabel={candidate.planKey ?? candidate.name}
                />
                <span className="font-medium text-primary-light">{candidate.planKey ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{candidate.name}</span>
                {/* The release, because that is what makes two plans different — and the status,
                    because a published target is what the second button is for. */}
                <span className="shrink-0 text-muted-foreground">
                  {candidate.releaseName ?? '—'}
                </span>
                <StatusBadge style={CAPACITY_STATUS_STYLE[candidate.status]} />
              </label>
            ))
          )}
        </div>

        {/* Rally's checkbox. Shown always so it does not appear and vanish as the selection changes,
            but the line underneath states whether it is doing anything for THIS pair. */}
        <label className="flex items-start gap-2 text-ui-sm text-foreground">
          <SelectionCheckbox
            checked={updateRelease}
            onChange={() => setUpdateRelease((current) => !current)}
            ariaLabel={t('move.updateRelease')}
          />
          <span>
            {t('move.updateRelease')}
            {releaseWouldMove && (
              <span className="block text-ui-xs text-warning">{t('move.releaseRequired')}</span>
            )}
          </span>
        </label>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        {/* No `Move and republish the plan` button: a published plan can no longer be a destination, so
            there is nothing to republish. The API still accepts `republish` — it is how a caller that
            legitimately targets a published plan puts it back — and the flag is simply never set here. */}
        <Button type="button" disabled={move.isPending} onClick={() => void run(false)}>
          {move.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('move.confirm')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
