import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { useCreateScmRepository, type ScmProvider } from '@/features/scm/api'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { Card, CardHeader, CardBody } from '@/shared/ui/card'
import { FormField } from '@/shared/ui/form-field'
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
    <Card>
      <CardHeader title={t('integrations.manualAdd.title')} />
      <CardBody className="space-y-4">
        <p className="text-ui-sm text-foreground-subtle">
          {t('integrations.manualAdd.description')}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t('integrations.manualAdd.provider')} className="w-40">
            <NativeSelect
              value={provider}
              onChange={(e) => setProvider(e.target.value as ScmProvider)}
            >
              <option value="github">{t('integrations.manualAdd.providers.github')}</option>
              <option value="ghe">{t('integrations.manualAdd.providers.ghe')}</option>
            </NativeSelect>
          </FormField>
          <FormField
            label={t('integrations.manualAdd.repositoryLabel')}
            className="min-w-[220px] flex-1"
          >
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="owner/repo"
            />
          </FormField>
          <Button type="button" onClick={() => void add()} disabled={createRepo.isPending}>
            {createRepo.isPending && <Loader2 size={12} className="animate-spin" />}
            {t('integrations.manualAdd.add')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
