import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { useCreateIterationItem, type Iteration } from '@/features/iterations/api'
import { useProjectMembers, useProjectTeams } from '@/features/teams/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { ownerSelectOptions } from '@/shared/ui/owner-cell'
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
  const { data: teams = [] } = useProjectTeams(projectId)
  const { project } = useAppContext()
  // Project / Team / Iteration are inherited from the iteration context and shown
  // read-only (P2-IS-FR-044/045); the created item picks them up server-side.
  const teamName = teams.find((tm) => tm.id === iteration.teamId)?.name ?? t('toolbar.noTeam', 'No team')
  const roBox = 'flex h-9 items-center rounded border border-input bg-input-background px-3 text-ui-md text-muted-foreground'
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

        {/* Project / Team / Iteration — read-only context (P2-IS-FR-044/045) */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('create.projectLabel', 'Project')}>
            <div className={roBox}>{project?.projectName ?? '—'}</div>
          </FormField>
          <FormField label={t('create.teamLabel', 'Team')}>
            <div className={roBox}>{teamName}</div>
          </FormField>
        </div>
        <FormField label={t('create.iterationLabel', 'Iteration')}>
          <div className={roBox}>{`${iteration.name} · ${fmtRange(iteration)}`}</div>
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
          <SearchableSelect
            variant="field"
            value={assigneeId}
            ariaLabel={t('common:owner')}
            placeholder={t('toolbar.unassigned')}
            options={ownerSelectOptions(members, assigneeId)}
            onChange={setAssigneeId}
          />
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
