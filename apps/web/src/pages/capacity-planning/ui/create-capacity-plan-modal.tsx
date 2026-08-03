import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { DetailReadonlyValue } from '@/shared/ui/detail'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import { useReleases } from '@/features/releases/api'
import {
  useCapacityPlans,
  useCreateCapacityPlan,
  type CapacityPlanUnit,
} from '@/features/capacity-planning/api'

/**
 * Create a capacity plan for a release.
 *
 * The release picker EXCLUDES releases that already have a plan — `uq_capacity_plan_project_release`
 * allows only one, so offering a planned release would let the user fill in the form and
 * then get a 409 for a choice the UI could have ruled out.
 *
 * `unit` is chosen here and fixed forever after: every number on the plan, including each
 * allocation, is expressed in it, so changing it later would reinterpret existing demand
 * rather than convert it. That is why it has no default selection nudging a choice.
 */
export function CreateCapacityPlanModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string
  /** Named, not just scoped: §77 shows the Project as a read-only row on this dialog. */
  projectName: string | null
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const navigate = useNavigate()
  const create = useCreateCapacityPlan()

  const { data: releases = [] } = useReleases(projectId)
  const { data: plans = [] } = useCapacityPlans(projectId)

  const [releaseId, setReleaseId] = useState('')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<CapacityPlanUnit>('points')
  const [errors, setErrors] = useState<{ name?: string; releaseId?: string; form?: string }>({})

  const available = useMemo(() => {
    const planned = new Set(plans.map((p) => p.releaseId))
    return releases.filter((r) => !planned.has(r.id))
  }, [releases, plans])

  async function submit() {
    const next: typeof errors = {}
    if (!name.trim()) next.name = t('create.nameRequired')
    if (!releaseId) next.releaseId = t('create.releaseRequired')
    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }
    setErrors({})
    try {
      const plan = await create.mutateAsync({ projectId, releaseId, name: name.trim(), unit })
      notify.success(t('create.created', { name: name.trim() }))
      onClose()
      if (plan?.id) {
        void navigate({ to: '/capacity-planning/$planId', params: { planId: plan.id } })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('create.createFailed')
      setErrors({ form: msg })
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('create.title')} width={460}>
      <ModalBody className="space-y-4">
        {errors.form && (
          <p role="alert" className="text-ui-sm text-destructive">
            {errors.form}
          </p>
        )}

        {/* The three rows §77-81 asks for and this dialog had none of: Project ("Current Project
            context, read-only"), Plan Type ("Fixed `Single Release`") and Portfolio Item Type ("Fixed
            `Feature`"). They are not inputs and never will be — a capacity plan covers one release and
            allocates Features, which is the model, not a choice — but stating them is what tells a
            planner what they are about to create. `DetailReadonlyValue` is the same collapsed-field
            treatment the detail rails use. */}
        <FormField label={t('create.projectLabel')}>
          <DetailReadonlyValue>{projectName ?? EMPTY_VALUE}</DetailReadonlyValue>
        </FormField>

        <div className="flex gap-3">
          <FormField label={t('create.planTypeLabel')} className="flex-1">
            <DetailReadonlyValue>{t('create.planTypeValue')}</DetailReadonlyValue>
          </FormField>
          <FormField label={t('create.itemTypeLabel')} className="flex-1">
            <DetailReadonlyValue>{t('create.itemTypeValue')}</DetailReadonlyValue>
          </FormField>
        </div>

        <FormField
          label={t('create.nameLabel')}
          required
          error={errors.name}
          htmlFor="capacity-name"
        >
          <Input
            id="capacity-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>

        <FormField label={t('create.releaseLabel')} required error={errors.releaseId}>
          <SearchableSelect
            variant="field"
            value={releaseId}
            ariaLabel={t('create.releaseLabel')}
            searchPlaceholder="Search"
            // `TypeBadge type="release"` — the glyph the Backlog and Portfolio release
            // pickers already use, so a release looks the same wherever it is chosen.
            options={available.map((r) => ({
              value: r.id,
              label: r.name,
              searchText: `${r.releaseKey ?? ''} ${r.name}`,
              icon: <TypeBadge type="release" size={16} />,
            }))}
            onChange={(v) => setReleaseId(v ?? '')}
          />
        </FormField>
        {available.length === 0 && (
          <p className="text-ui-xs text-foreground-subtle">{t('create.noReleasesLeft')}</p>
        )}

        <FormField label={t('create.unitLabel')}>
          <SearchableSelect
            variant="field"
            value={unit}
            ariaLabel={t('create.unitLabel')}
            options={[
              { value: 'points', label: t('units.points') },
              { value: 'count', label: t('units.count') },
            ]}
            onChange={(v) => setUnit((v as CapacityPlanUnit) ?? 'points')}
          />
        </FormField>
        <p className="text-ui-xs text-foreground-subtle">{t('create.unitFixedHint')}</p>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          type="button"
          disabled={create.isPending || !name.trim() || !releaseId}
          onClick={() => void submit()}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('create.createButton')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
