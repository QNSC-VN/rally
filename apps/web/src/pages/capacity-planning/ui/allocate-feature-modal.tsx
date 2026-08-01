import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, X } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import { IconButton } from '@/shared/ui/icon-button'
import {
  useAllocate,
  useRemoveAllocation,
  useUpdateAllocation,
  type CapacityPlan,
} from '@/features/capacity-planning/api'

/**
 * Rally's `Allocate to Projects`: split ONE Feature across several teams in a single pass.
 *
 * The dialog is a table, because Rally's is — "select the first team that you want to allocate this
 * portfolio item to from the Project drop-down list and enter the number of story points or count to
 * allocate for this team in the Estimate field", then `Add project` for the next one, then `Apply`.
 * It opens seeded with the Feature's CURRENT allocations, so a planner adding a third team can see
 * what the first two already carry; the previous version took one team per opening and showed
 * nothing, which made a three-way split three trips through a dialog that never showed the split.
 *
 * A blank Estimate allocates the Feature's OWN estimate (Refined → Preliminary) to that team, which
 * is Rally's rule — "leave the Estimate field blank to allocate the entire original estimate" — and
 * why its `Allocation` column is empty on those rows. The default deliberately never folds in
 * existing allocations: a blank field must not commit the sum of the very allocations it is being
 * used to create.
 *
 * NOT here: which team OWNS the Feature, and removal. Rally sets ownership through
 * `Planned Team Assignment` on the grid (our star / assignment cell) and removes through the item's
 * gear (`Remove All Assignments`, `Remove From Plan`), so putting either in this dialog would give
 * the same decision two homes.
 */
export function AllocateFeatureModal({
  plan,
  portfolioItemId,
  onClose,
}: {
  plan: CapacityPlan
  /** The Feature being split — this dialog opens from its own row, so it is stated, not chosen. */
  portfolioItemId: string
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const allocate = useAllocate()
  const updateAllocation = useUpdateAllocation()
  const removeAllocation = useRemoveAllocation()

  /** This Feature's allocations, in plan order — the rows the dialog opens with. */
  const existing = useMemo(
    () => plan.allocations.filter((a) => a.portfolioItemId === portfolioItemId),
    [plan.allocations, portfolioItemId],
  )

  const item = plan.items.find((i) => i.portfolioItemId === portfolioItemId)
  const featureLabel = useMemo(() => {
    const row = existing[0]
    if (item !== undefined) return `${item.itemKey} — ${item.name}`
    return row === undefined ? portfolioItemId : `${row.itemKey} — ${row.name}`
  }, [item, existing, portfolioItemId])

  /**
   * The Feature's two top-down estimates, stated in the header.
   *
   * The BA's dialog identifies the item by `ID`, `Name`, `Prelim Estimate` and `Refined Estimate`,
   * and it has to: a blank Estimate row commits `Refined ?? Preliminary`, so a planner deciding
   * whether to leave one blank needs to see what that number IS without leaving the dialog.
   *
   * Read from an existing allocation's breakdown rather than fetched: the plan already carries both
   * figures per row, and a second source could disagree with the grid behind the dialog.
   */
  const estimates = existing[0]?.estimateBreakdown ?? null
  /**
   * Refined, else Preliminary — with ZERO treated as absent, not as a value.
   *
   * `refined ?? preliminary` kept a refined estimate of 0, so `Total allocated` read 0 for a Feature
   * whose blank row Apply would charge at its preliminary size. The backend already resolves the tier
   * this way ("Refined … -> if > 0"), so this only stops the dialog from disagreeing with it.
   */
  const topDown =
    estimates === null
      ? null
      : estimates.refined !== null && estimates.refined > 0
        ? estimates.refined
        : estimates.preliminary

  /**
   * One row per allocation, plus whatever the planner adds.
   *
   * `allocationId` is what tells Apply whether a row is an edit or an insert. A row with no team is
   * legal while editing — an item added to the plan unassigned already IS such a row — and only has
   * to name a team by the time Apply runs.
   */
  const [rows, setRows] = useState<
    { key: string; allocationId: string | null; teamId: string; value: string }[]
  >(() =>
    existing.length === 0
      ? [{ key: 'new-0', allocationId: null, teamId: '', value: '' }]
      : existing.map((a) => ({
          key: a.id,
          allocationId: a.id,
          teamId: a.teamId ?? '',
          value: a.value === null ? '' : String(a.value),
        })),
  )
  const [error, setError] = useState<string | null>(null)
  /**
   * Allocations the planner has struck out but not yet applied.
   *
   * Deferred rather than deleted on click, because everything else in this dialog is: `Apply` is the
   * commit, so a row that vanished from the server the moment its × was pressed would make Cancel a
   * lie.
   */
  const [removedIds, setRemovedIds] = useState<string[]>([])

  const pending = allocate.isPending || updateAllocation.isPending || removeAllocation.isPending

  /**
   * Every team on the plan, minus the ones other rows already hold.
   *
   * A team may carry at most one allocation of a Feature — the database says so
   * (`uq_capacity_allocation_team`) — so offering it twice would build a dialog whose Apply is
   * guaranteed to fail on the second row.
   */
  const optionsFor = (rowKey: string) => {
    const taken = new Set(
      rows.filter((r) => r.key !== rowKey && r.teamId !== '').map((r) => r.teamId),
    )
    return plan.teams
      .filter((team) => !taken.has(team.teamId))
      .map((team) => ({ value: team.teamId, label: team.teamName ?? '--' }))
  }

  const canAddRow = rows.length < plan.teams.length

  function setRow(key: string, patch: { teamId?: string; value?: string }) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  /**
   * Drops a row from the table. An unsaved row simply disappears; a saved one is queued for deletion
   * so `Apply` performs it, keeping Cancel honest.
   */
  function dropRow(key: string, allocationId: string | null) {
    setRows((current) => current.filter((r) => r.key !== key))
    if (allocationId !== null) setRemovedIds((current) => [...current, allocationId])
  }

  /**
   * Rally's / the BA's `Total allocated`: what this Feature's Estimated becomes once applied.
   *
   * A blank row counts as the top-down estimate, because that is exactly what Apply will store for
   * it — showing 0 there would understate the commitment the planner is about to make.
   */
  const totalAllocated = rows.reduce((sum, row) => {
    const trimmed = row.value.trim()
    if (trimmed === '') return sum + (topDown ?? 0)
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? sum + parsed : sum
  }, 0)

  /**
   * Applies the rows as a diff: an edited allocation is PATCHed, a new row is POSTed, an untouched
   * row is left alone.
   *
   * Sequential rather than parallel: each write returns the whole plan, so firing them together
   * would race the responses to decide which snapshot the cache keeps. Sending only what changed
   * also keeps Apply a no-op when a planner opens the dialog and closes it again.
   */
  async function apply() {
    const before = new Map(existing.map((a) => [a.id, a]))
    const changes: (() => Promise<unknown>)[] = []

    // Removals first: they free the (plan, item, team) slot a later row may be claiming, so doing
    // them last could make an otherwise valid re-assignment collide with a row on its way out.
    for (const allocationId of removedIds) {
      changes.push(() => removeAllocation.mutateAsync({ id: plan.id, allocationId }))
    }

    for (const row of rows) {
      const trimmed = row.value.trim()
      const value = trimmed === '' ? null : Number(trimmed)
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        setError(t('row.capacityInvalid'))
        return
      }

      const prior = row.allocationId === null ? undefined : before.get(row.allocationId)
      if (prior === undefined) {
        // A new row with no team is an empty line the planner never filled in, not an error: only
        // block Apply when it is the ONLY row, because then the dialog would do nothing at all.
        if (row.teamId === '') {
          if (rows.length === 1) {
            setError(t('allocate.teamRequired'))
            return
          }
          continue
        }
        const teamId = row.teamId
        changes.push(() =>
          allocate.mutateAsync({
            id: plan.id,
            portfolioItemId,
            teamId,
            ...(value === null ? {} : { value }),
          }),
        )
        continue
      }

      // An existing row: PATCH only the fields that moved. `value: null` is a real edit — it clears
      // the allocation so the row charges the Feature's own estimate again.
      const teamMoved = row.teamId !== (prior.teamId ?? '')
      const valueMoved = value !== prior.value
      if (!teamMoved && !valueMoved) continue
      if (teamMoved && row.teamId === '') {
        setError(t('allocate.teamRequired'))
        return
      }
      const allocationId = prior.id
      const nextTeamId = row.teamId
      changes.push(() =>
        updateAllocation.mutateAsync({
          id: plan.id,
          allocationId,
          ...(teamMoved ? { teamId: nextTeamId } : {}),
          ...(valueMoved ? { value } : {}),
        }),
      )
    }

    if (changes.length === 0) {
      onClose()
      return
    }

    setError(null)
    try {
      for (const change of changes) await change()
      notify.success(t('allocate.applied'))
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('allocate.failed')
      setError(msg)
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('allocate.title')} width={520}>
      <ModalBody className="space-y-3">
        {error !== null && (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        )}

        {/* The BA's read-only identity row: which Feature, and the two estimates a blank Estimate
            falls back to. Without them "leave it blank" is a number the planner cannot see. */}
        <div className="rounded-sm border border-border-inner bg-surface-subtle px-2 py-1.5">
          <p className="text-ui-xs font-semibold text-muted-foreground">
            {t('allocate.featureLabel')}
          </p>
          <p className="text-ui-md text-foreground">{featureLabel}</p>
          <div className="mt-1 flex gap-4 text-ui-xs text-muted-foreground">
            <span>
              {t('allocate.prelimEstimate')}{' '}
              <span className="font-medium text-foreground tabular-nums">
                {estimates?.preliminary ?? '—'}
              </span>
            </span>
            <span>
              {t('allocate.refinedEstimate')}{' '}
              <span className="font-medium text-foreground tabular-nums">
                {estimates?.refined ?? '—'}
              </span>
            </span>
          </div>
        </div>

        {/* Rally's two-column table, header included: the pair on each line is "this team, this
            many", and a stack of labelled fields did not read as a split. */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 border-b border-border-inner pb-1">
            <span className="flex-1 text-ui-xs font-semibold text-muted-foreground">
              {t('allocate.teamLabel')}
            </span>
            <span className="w-28 text-ui-xs font-semibold text-muted-foreground">
              {t('allocate.valueLabel')}
            </span>
            {/* Spacer over the per-row × so the two header labels stay above their own columns. */}
            <span className="w-6 shrink-0" aria-hidden />
          </div>

          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  variant="field"
                  value={row.teamId}
                  ariaLabel={t('allocate.teamLabel')}
                  placeholder={t('allocate.selectTeam')}
                  options={optionsFor(row.key)}
                  onChange={(v) => setRow(row.key, { teamId: v })}
                />
              </div>
              <Input
                value={row.value}
                onChange={(e) => setRow(row.key, { value: e.target.value })}
                placeholder={t('allocate.valuePlaceholder')}
                aria-label={t('allocate.valueLabel')}
                inputMode="decimal"
                className="w-28"
              />
              {/* Each row removable, per the BA. Dropping the LAST row is allowed and means "this
                  Feature keeps no team": Apply deletes the allocation and the Feature falls back to
                  the plan's unassigned bucket, which is the same end state as `Remove All
                  Assignments`. */}
              <IconButton
                aria-label={t('allocate.removeRow')}
                onClick={() => dropRow(row.key, row.allocationId)}
              >
                <X size={12} />
              </IconButton>
            </div>
          ))}

          {/* Rally's `Add project`. Gone once every team on the plan holds a row — there is nothing
              left to allocate to, and the extra line would only offer an empty picker. */}
          {canAddRow && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    key: `new-${String(current.length)}`,
                    allocationId: null,
                    teamId: '',
                    value: '',
                  },
                ])
              }
            >
              <Plus size={13} /> {t('allocate.addRow')}
            </Button>
          )}
        </div>

        {/* The BA's live `Total allocated`: what the Feature's Estimated becomes once applied. It sits
            below the rows because it is their sum, and it counts a blank row as the top-down
            estimate — which is what Apply will store for it. */}
        <div className="flex items-center justify-between border-t border-border-inner pt-1.5">
          <span className="text-ui-sm font-semibold text-muted-foreground">
            {t('allocate.totalAllocated')}
          </span>
          <span className="text-ui-md font-semibold text-foreground tabular-nums">
            {totalAllocated}
          </span>
        </div>

        <p className="text-ui-xs text-foreground-subtle">{t('allocate.defaultHint')}</p>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button type="button" disabled={pending} onClick={() => void apply()}>
          {pending && <Loader2 size={11} className="animate-spin" />}
          {t('allocate.submit')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
