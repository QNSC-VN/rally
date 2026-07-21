import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { useCreateIterationItem, type Iteration } from '@/features/iterations/api'
import { useProjectMembers } from '@/features/teams/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { fmtRange } from '../model/iteration-helpers'

export function AddItemModal({
  iteration,
  projectId,
  onClose,
  onCreated,
}: {
  iteration: Iteration
  projectId: string | undefined
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation('iteration-status')
  const navigate = useNavigate()
  const create = useCreateIterationItem(iteration.id)
  const { data: members = [] } = useProjectMembers(projectId)
  const [type, setType] = useState<'story' | 'defect'>('story')
  const [title, setTitle] = useState('')
  const [planEstimate, setPlanEstimate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(openDetail = false) {
    setError(null)
    if (!title.trim()) {
      setError(t('create.titleRequired'))
      return
    }
    try {
      const result = await create.mutateAsync({
        type,
        title: title.trim(),
        planEstimate: planEstimate === '' ? undefined : Number(planEstimate),
        assigneeId: assigneeId || undefined,
      })
      notify.success(
        t('create.added', {
          type: type === 'defect' ? t('create.defect') : t('create.story'),
          title: title.trim(),
        }),
      )
      if (openDetail) {
        void navigate({ to: '/item/$itemKey', params: { itemKey: result.itemKey } })
      } else {
        onCreated()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('create.createFailed')
      setError(msg)
      notify.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('create.title')}
      subtitle={`${iteration.name} · ${fmtRange(iteration)}`}
      width={460}
    >
      <ModalBody className="space-y-4">
        {/* Type toggle */}
        <FormField label={t('create.typeLabel')}>
          <div className="flex gap-2">
            {(['story', 'defect'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setType(o)}
                className={cn(
                  'flex-1 rounded-sm border py-1.5 text-ui-sm font-semibold capitalize transition-colors',
                  type === o
                    ? 'border-accent-border bg-primary-lighter text-primary'
                    : 'border-border-subtle text-muted-foreground',
                )}
              >
                {o}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label={t('create.titleLabel')} required error={error ?? undefined}>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a concise work item title..."
          />
        </FormField>

        <FormField label={t('create.planEstimateLabel')}>
          <Input
            type="number"
            min={0}
            value={planEstimate}
            onChange={(e) => setPlanEstimate(e.target.value)}
            placeholder="0"
          />
        </FormField>

        <FormField label={t('common:owner')}>
          <NativeSelect value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t('toolbar.unassigned')}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName ?? m.email ?? m.userId}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={create.isPending}
          onClick={() => submit(true)}
        >
          {t('create.withDetails')}
        </Button>
        <Button type="button" disabled={create.isPending} onClick={() => submit(false)}>
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('create.createItem')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
