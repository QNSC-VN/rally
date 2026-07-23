import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjects, useUpdateProject } from '@/features/projects/api'
import { useResetOnIdChange } from '@/shared/lib/hooks/use-reset-on-id-change'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

export function ProjectSettingsTab() {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const activeProject = useAppContext((s) => s.project)
  const setProject = useAppContext((s) => s.setProject)
  const { data: projects = [] } = useProjects(workspaceId)
  const current = projects.find((p) => p.id === activeProject?.projectId)
  const update = useUpdateProject()

  const [name, setName] = useState(current?.name ?? activeProject?.projectName ?? '')
  const [description, setDescription] = useState(current?.description ?? '')

  useResetOnIdChange(current?.id, () => {
    setName(current!.name)
    setDescription(current!.description ?? '')
  })

  if (!activeProject) {
    return <p className="text-ui-lg text-foreground-subtle">{t('noProjectSelected')}</p>
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeProject || !name.trim()) return
    try {
      await update.mutateAsync({
        id: activeProject.projectId,
        input: { name: name.trim(), description: description.trim() || undefined },
      })
      setProject({
        projectId: activeProject.projectId,
        projectKey: activeProject.projectKey,
        projectName: name.trim(),
      })
      notify.success(t('project.saved'))
    } catch (err) {
      notify.fromError(err, t('project.saveFailed'))
    }
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="max-w-lg space-y-5">
      <div className="mb-2 rounded-md border bg-surface-subtle px-3 py-2 text-ui-md text-foreground-subtle">
        {t('project.projectLabel')}{' '}
        <span className="font-semibold text-foreground">
          {activeProject.projectKey} — {activeProject.projectName}
        </span>
      </div>
      <FormField label={t('project.nameLabel')} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
      </FormField>
      <FormField label={t('common:description')}>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this project deliver?"
          rows={3}
        />
      </FormField>
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={update.isPending || !name.trim()}>
          {update.isPending && <Loader2 size={12} className="animate-spin" />}
          {t('saveChanges')}
        </Button>
      </div>
    </form>
  )
}
