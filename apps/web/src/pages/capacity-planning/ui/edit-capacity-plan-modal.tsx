import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { DateField } from '@/shared/ui/date-field'
import { notify } from '@/shared/lib/toast'
import { useUpdateCapacityPlan, type CapacityPlan } from '@/features/capacity-planning/api'

/**
 * Rally's "Edit Plan Details", reached from the plan's Actions menu.
 *
 * Holds exactly what the API lets a draft change: name, the planned window, and the advisory target
 * load. `unit` and `release` are absent on purpose — every number on the plan is expressed in the
 * unit and scoped to the release, so changing either would reinterpret existing demand rather than
 * move it. (Rally's Points/Count control is a VIEW metric, not the stored unit.)
 *
 * Drafts only, because the API refuses a published plan: "You cannot modify a plan while it is in a
 * published state." The menu hides the item rather than letting the modal collect an edit the
 * server will reject.
 */
export function EditCapacityPlanModal({
  plan,
  onClose,
}: {
  plan: CapacityPlan
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const update = useUpdateCapacityPlan()

  const [name, setName] = useState(plan.name)
  const [startDate, setStartDate] = useState(plan.plannedStartDate)
  const [endDate, setEndDate] = useState(plan.plannedEndDate)
  const [errors, setErrors] = useState<{ name?: string; form?: string }>({})

  async function submit() {
    const next: typeof errors = {}
    if (!name.trim()) next.name = t('edit.nameRequired')
    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }
    setErrors({})
    try {
      await update.mutateAsync({
        id: plan.id,
        patch: {
          name: name.trim(),
          // `null` clears a date; `undefined` would leave it alone, so an emptied field has to send
          // null explicitly.
          plannedStartDate: startDate,
          plannedEndDate: endDate,
        },
      })
      notify.success(t('edit.saved'))
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('edit.failed')
      setErrors({ form: msg })
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('edit.title')} width={460}>
      <ModalBody className="space-y-4">
        {errors.form && (
          <p role="alert" className="text-ui-sm text-destructive">
            {errors.form}
          </p>
        )}

        <FormField label={t('edit.nameLabel')} required error={errors.name} htmlFor="plan-name">
          <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>

        <div className="flex gap-3">
          <FormField label={t('detail.fields.plannedStartDate')} className="flex-1">
            <DateField
              value={startDate}
              ariaLabel={t('detail.fields.plannedStartDate')}
              onChange={setStartDate}
            />
          </FormField>
          <FormField label={t('detail.fields.plannedEndDate')} className="flex-1">
            <DateField
              value={endDate}
              ariaLabel={t('detail.fields.plannedEndDate')}
              onChange={setEndDate}
            />
          </FormField>
        </div>

        <p className="text-ui-xs text-foreground-subtle">{t('edit.unitFixedHint')}</p>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button type="button" disabled={update.isPending} onClick={() => void submit()}>
          {update.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('edit.saveButton')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
