import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useWorkspaces,
  useUpdateWorkspace,
  useWorkspaceMembers,
  useWorkspaceSettings,
  useUpdateWorkspaceSettings,
} from '@/features/workspaces/api'
import { useResetOnIdChange } from '@/shared/lib/hooks/use-reset-on-id-change'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { Card, CardHeader, CardBody } from '@/shared/ui/card'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { TIMEZONES, LOCALES } from '@/shared/config/formatting-options'

export function WorkspaceSettingsTab() {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const setWorkspace = useAppContext((s) => s.setWorkspace)
  const workspace = useAppContext((s) => s.workspace)
  const { data: workspaces = [] } = useWorkspaces()
  const current = workspaces.find((w) => w.id === workspaceId)
  const update = useUpdateWorkspace(workspaceId)
  const { data: settings } = useWorkspaceSettings(workspaceId)
  const updateSettings = useUpdateWorkspaceSettings(workspaceId)

  // Read-only workspace admins, derived from the shared members-with-profile roster.
  const { data: allMembers = [] } = useWorkspaceMembers(workspaceId)
  const admins = allMembers.filter((m) => m.roleSlug === 'workspace_admin')

  const [name, setName] = useState(current?.name ?? workspace?.workspaceName ?? '')
  const [description, setDescription] = useState(current?.description ?? '')
  // Workspace formatting defaults — the fallback for members who haven't set
  // their own. Empty string = "not set".
  const [timezone, setTimezone] = useState(settings?.timezone ?? '')
  const [locale, setLocale] = useState(settings?.defaultLocale ?? '')

  useResetOnIdChange(current?.id, () => {
    setName(current!.name)
    setDescription(current!.description ?? '')
  })
  useResetOnIdChange(settings ? workspaceId : undefined, () => {
    setTimezone(settings?.timezone ?? '')
    setLocale(settings?.defaultLocale ?? '')
  })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !name.trim()) return
    try {
      const [updated] = await Promise.all([
        update.mutateAsync({ name: name.trim(), description: description.trim() || null }),
        updateSettings.mutateAsync({
          timezone: timezone || null,
          defaultLocale: locale || null,
        }),
      ])
      setWorkspace({
        workspaceId,
        workspaceSlug: workspace?.workspaceSlug ?? '',
        workspaceName: updated.name,
      })
      notify.success(t('workspace.saved'))
    } catch (err) {
      notify.fromError(err, t('workspace.saveFailed'))
    }
  }

  const saving = update.isPending || updateSettings.isPending

  return (
    <div className="max-w-2xl space-y-6">
      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        <Card>
          <CardHeader title={t('workspace.sectionTitle')} />
          <CardBody className="space-y-4">
            {/* Read-only identity */}
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2.5 text-ui-md">
              <dt className="text-foreground-subtle">{t('workspace.slugLabel')}</dt>
              <dd className="font-mono text-foreground">
                {current?.slug ?? workspace?.workspaceSlug ?? '—'}
              </dd>
              <dt className="text-foreground-subtle">{t('workspace.adminLabel')}</dt>
              <dd className="text-foreground">
                {admins.length === 0 ? '—' : admins.map((a) => a.displayName).join(', ')}
              </dd>
            </dl>

            <FormField label={t('workspace.nameLabel')} required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workspace.namePlaceholder')}
              />
            </FormField>
            <FormField label={t('common:description')}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('workspace.descriptionPlaceholder')}
                rows={3}
              />
            </FormField>

            {/* Company-wide formatting defaults — the fallback each member inherits
                until they override it in their own Profile. */}
            <FormField label={t('workspace.defaultTimezone', 'Default timezone')}>
              <SearchableSelect
                value={timezone}
                ariaLabel={t('workspace.defaultTimezone', 'Default timezone')}
                options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                onChange={(v) => setTimezone(v ?? '')}
              />
            </FormField>
            <FormField label={t('workspace.defaultLocale', 'Default date/number format')}>
              <SearchableSelect
                value={locale}
                ariaLabel={t('workspace.defaultLocale', 'Default date/number format')}
                options={LOCALES}
                onChange={(v) => setLocale(v ?? '')}
              />
            </FormField>
          </CardBody>
        </Card>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t('saveChanges')}
          </Button>
        </div>
      </form>
    </div>
  )
}
