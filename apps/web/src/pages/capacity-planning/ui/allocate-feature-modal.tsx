import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import { usePortfolioItems } from '@/features/portfolio/api'
import { useAllocate, type CapacityPlan } from '@/features/capacity-planning/api'

/**
 * Allocate a Feature to a team, or park it in the Unallocated bucket.
 *
 * Only FEATURES are offered — an Epic has no children of its own to roll up, so allocating
 * to one would produce a row whose Rollup is permanently zero. The API refuses it too.
 *
 * Leaving Estimate blank accepts the server's default: Refined → Preliminary, deliberately
 * SKIPPING the allocated tier. That is the anti-circularity rule — if the default folded in
 * existing allocations, a blank field would commit the sum of the very allocations it is
 * being used to create. The hint under the field says so, because a silent default that
 * differs from the number shown elsewhere on the page is worse than no default.
 */
export function AllocateFeatureModal({
  plan,
  onClose,
}: {
  plan: CapacityPlan
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const allocate = useAllocate()

  const [portfolioItemId, setPortfolioItemId] = useState('')
  const [teamId, setTeamId] = useState<string>('')
  const [value, setValue] = useState('')
  const [errors, setErrors] = useState<{ feature?: string; form?: string }>({})

  // Features in the plan's own project; the API enforces the same scope.
  const { items: features } = usePortfolioItems({
    type: PortfolioItemType.Feature,
    projectId: plan.projectId,
  })

  const teamOptions = useMemo(
    () => [
      { value: '', label: t('detail.unallocated') },
      ...plan.teams.map((team) => ({ value: team.teamId, label: team.teamName ?? '--' })),
    ],
    [plan.teams, t],
  )

  async function submit() {
    if (!portfolioItemId) {
      setErrors({ feature: t('allocate.featureRequired') })
      return
    }
    const trimmed = value.trim()
    const parsed = trimmed === '' ? undefined : Number(trimmed)
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) {
      setErrors({ form: t('row.capacityInvalid') })
      return
    }
    setErrors({})
    try {
      await allocate.mutateAsync({
        id: plan.id,
        portfolioItemId,
        // '' means the Unallocated bucket, which the API models as a null team.
        teamId: teamId === '' ? null : teamId,
        ...(parsed === undefined ? {} : { value: parsed }),
      })
      notify.success(t('allocate.allocated'))
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('allocate.failed')
      setErrors({ form: msg })
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('allocate.title')} width={460}>
      <ModalBody className="space-y-4">
        {errors.form && (
          <p role="alert" className="text-ui-sm text-destructive">
            {errors.form}
          </p>
        )}

        <FormField label={t('allocate.featureLabel')} required error={errors.feature}>
          <SearchableSelect
            variant="field"
            value={portfolioItemId}
            ariaLabel={t('allocate.featureLabel')}
            options={features.map((f) => ({ value: f.id, label: `${f.itemKey} — ${f.name}` }))}
            onChange={(v) => setPortfolioItemId(v ?? '')}
          />
        </FormField>

        <FormField label={t('allocate.teamLabel')}>
          <SearchableSelect
            variant="field"
            value={teamId}
            ariaLabel={t('allocate.teamLabel')}
            options={teamOptions}
            onChange={(v) => setTeamId(v ?? '')}
          />
        </FormField>

        <FormField label={t('allocate.valueLabel')} htmlFor="allocate-value">
          <Input
            id="allocate-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('allocate.valuePlaceholder')}
            inputMode="decimal"
          />
        </FormField>
        <p className="text-ui-xs text-foreground-subtle">{t('allocate.defaultHint')}</p>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          type="button"
          disabled={allocate.isPending || !portfolioItemId}
          onClick={() => void submit()}
        >
          {allocate.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('allocate.submit')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
