import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { useCreateScmRepository, type ScmProvider } from '@/features/scm/api'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'

interface ManualAddFormProps {
  workspaceId: string | undefined
}

/** Fallback: register a repository by owner/name (for repos outside an installation). */
export function ManualAddForm({ workspaceId }: ManualAddFormProps) {
  const { t } = useTranslation('settings')
  const createRepo = useCreateScmRepository(workspaceId)
  const [provider, setProvider] = useState<ScmProvider>('github')
  const [fullName, setFullName] = useState('')

  async function add() {
    const name = fullName.trim()
    if (!name) {
      notify.error(t('integrations.manualAdd.invalid'))
      return
    }
    try {
      await createRepo.mutateAsync({ provider, fullName: name })
      notify.success(t('integrations.manualAdd.added', { name }))
      setFullName('')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Failed to add repository')
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-ui-md font-semibold text-foreground">
          {t('integrations.manualAdd.title')}
        </h3>
        <p className="text-ui-xs text-foreground-subtle">
          {t('integrations.manualAdd.description')}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-ui-xs text-foreground-subtle">
            {t('integrations.manualAdd.provider')}
          </span>
          <NativeSelect
            value={provider}
            onChange={(e) => setProvider(e.target.value as ScmProvider)}
          >
            <option value="github">{t('integrations.manualAdd.providers.github')}</option>
            <option value="ghe">{t('integrations.manualAdd.providers.ghe')}</option>
          </NativeSelect>
        </label>
        <label className="flex flex-1 flex-col gap-1" style={{ minWidth: 220 }}>
          <span className="text-ui-xs text-foreground-subtle">
            {t('integrations.manualAdd.repositoryLabel')}
          </span>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="owner/repo"
          />
        </label>
        <Button type="button" onClick={() => void add()} disabled={createRepo.isPending}>
          {createRepo.isPending && <Loader2 size={12} className="animate-spin" />}
          {t('integrations.manualAdd.add')}
        </Button>
      </div>
    </section>
  )
}
