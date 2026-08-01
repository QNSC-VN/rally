import { useState } from 'react'
import { SettingsTabHeader } from './settings-tab-header'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { PreliminaryEstimateCard } from './preliminary-estimate-card'
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
import { OwnerAvatar } from '@/shared/ui/owner-cell'
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
  // The COMPLETE effective map, as the GET returns it. Undefined until settings load, so the
  // card only renders once there is something real to edit.
  const [estimateMap, setEstimateMap] = useState(settings?.preliminaryEstimateMap)

  useResetOnIdChange(current?.id, () => {
    setName(current!.name)
    setDescription(current!.description ?? '')
  })
  useResetOnIdChange(settings ? workspaceId : undefined, () => {
    setTimezone(settings?.timezone ?? '')
    setLocale(settings?.defaultLocale ?? '')
    setEstimateMap(settings?.preliminaryEstimateMap)
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
          // Only the sizes that actually changed. Sending all six would work — the server
          // merges either way — but it would persist a copy of today's defaults as overrides,
          // so a later change to the seeded scale would stop reaching this workspace. A
          // minimal override set keeps the default meaningful.
          ...(changedSizes ? { preliminaryEstimateMap: changedSizes } : {}),
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

  // Diffed against what the server sent, so an untouched table sends nothing at all.
  const changedSizes = (() => {
    const before = settings?.preliminaryEstimateMap
    if (!before || !estimateMap) return undefined
    const diff = Object.fromEntries(
      Object.entries(estimateMap).filter(
        ([size, v]) =>
          v.points !== before[size as keyof typeof before]?.points ||
          v.count !== before[size as keyof typeof before]?.count,
      ),
    )
    return Object.keys(diff).length > 0 ? diff : undefined
  })()

  const saving = update.isPending || updateSettings.isPending

  return (
    <>
      <SettingsTabHeader
        contained
        title={t('nav.workspace')}
        description={t('tabDescriptions.workspace')}
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* General + Regional defaults share one RHF-less form + Save footer,
          mirroring the Profile tab's two-card + footer layout. */}
          <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
            <Card>
              <CardHeader title={t('workspace.sectionGeneral')} />
              <CardBody className="space-y-4">
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
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('workspace.sectionFormatting')} />
              <CardBody className="space-y-4">
                <FormField label={t('workspace.defaultTimezone')}>
                  <SearchableSelect
                    variant="field"
                    value={timezone}
                    ariaLabel={t('workspace.defaultTimezone')}
                    options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                    onChange={(v) => setTimezone(v ?? '')}
                  />
                </FormField>
                <FormField label={t('workspace.defaultLocale')}>
                  <SearchableSelect
                    variant="field"
                    value={locale}
                    ariaLabel={t('workspace.defaultLocale')}
                    options={LOCALES}
                    onChange={(v) => setLocale(v ?? '')}
                  />
                </FormField>
              </CardBody>
            </Card>

            {/* The denominator behind every Estimated Progress meter — see the card. */}
            {estimateMap && (
              <PreliminaryEstimateCard value={estimateMap} onChange={setEstimateMap} />
            )}

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                {t('saveChanges')}
              </Button>
            </div>
          </form>

          {/* Read-only identity — mirrors the Profile tab's Account card. */}
          <Card>
            <CardHeader title={t('workspace.sectionDetails')} />
            <CardBody className="divide-y divide-border-subtle">
              {/* Slug — a URL-safe identifier, shown as a mono pill with a hint. */}
              <div className="flex items-start justify-between gap-4 pb-4">
                <div className="min-w-0">
                  <p className="text-ui-md font-medium text-foreground">
                    {t('workspace.slugLabel')}
                  </p>
                  <p className="mt-0.5 text-ui-sm text-foreground-subtle">
                    {t('workspace.slugHint')}
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-input bg-surface-subtle px-2 py-0.5 font-mono text-ui-sm text-foreground">
                  {current?.slug ?? workspace?.workspaceSlug ?? '--'}
                </span>
              </div>
              {/* Admins — avatar chips. */}
              <div className="flex items-start justify-between gap-4 pt-4">
                <p className="text-ui-md font-medium text-foreground">
                  {t('workspace.adminLabel')}
                </p>
                <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
                  {admins.length === 0 ? (
                    <span className="text-ui-md text-foreground-subtle">--</span>
                  ) : (
                    admins.map((a) => (
                      <span
                        key={a.userId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle py-0.5 pr-2.5 pl-0.5 text-ui-sm text-foreground"
                      >
                        <OwnerAvatar name={a.displayName ?? a.email ?? undefined} size={18} />
                        <span className="truncate">{a.displayName ?? a.email}</span>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
