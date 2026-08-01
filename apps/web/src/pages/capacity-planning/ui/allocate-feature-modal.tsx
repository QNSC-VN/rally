import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import {
  useAllocate,
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

  /** This Feature's allocations, in plan order — the rows the dialog opens with. */
  const existing = useMemo(
    () => plan.allocations.filter((a) => a.portfolioItemId === portfolioItemId),
    [plan.allocations, portfolioItemId],
  )

  const featureLabel = useMemo(() => {
    const item = plan.items.find((i) => i.portfolioItemId === portfolioItemId)
    const row = existing[0]
    if (item !== undefined) return `${item.itemKey} — ${item.name}`
    return row === undefined ? portfolioItemId : `${row.itemKey} — ${row.name}`
  }, [plan.items, existing, portfolioItemId])

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

  const pending = allocate.isPending || updateAllocation.isPending

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

        <div>
          <p className="text-ui-xs font-semibold text-muted-foreground">
            {t('allocate.featureLabel')}
          </p>
          <p className="text-ui-md text-foreground">{featureLabel}</p>
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
