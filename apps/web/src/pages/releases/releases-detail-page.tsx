/**
 * Release Detail Page — P3.2 Release Management
 *
 * Visual layout matching SRS §5 and §6.1 with rich text editing areas (Theme, Notes) on the left
 * and a right sidebar panel for metadata fields, status validation, and task roll-up/acceptance metrics.
 * P3.3: Added Artifacts tab showing linked US/DE work items.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { FileText, Loader2, Package } from 'lucide-react'
import { DetailLayout, DetailTwoPane } from '@/shared/ui/detail/detail-layout'
import { DetailField, DetailFieldPair, DetailReadonlyValue } from '@/shared/ui/detail/detail-field'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { DateField } from '@/shared/ui/date-field'
import { Input } from '@/shared/ui/input'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { SaveCancelBar } from '@/shared/ui/save-cancel-bar'
import { usePendingPatch } from '@/shared/lib/hooks/use-pending-patch'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { ReleaseArtifactsTab } from './ui/release-artifacts-tab'
import { TaskRollupPanel, BurndownPanel } from './ui/release-detail-panels'
import { RELEASE_STATES, RELEASE_STATUS_STYLE } from './model/release-states'
import { useProjectPermissions } from '@/features/access/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useRelease,
  useUpdateRelease,
  useReleaseBurndown,
  type Release,
  type ReleaseStatus,
  type UpdateReleaseInput,
} from '@/features/releases/api'

type TabKey = 'details' | 'artifacts'

export function ReleaseDetailPage() {
  const { t } = useTranslation('releases')
  const navigate = useNavigate()
  const { releaseId } = useParams({ from: '/auth/releases/$releaseId' })
  const { project } = useAppContext()
  const projectId = project?.projectId ?? ''
  const { can } = useProjectPermissions(projectId || undefined)
  const canManage = can('release:create') || can('release:edit') || can('release:delete')

  const { data: release, isLoading, isError } = useRelease(releaseId)
  const update = useUpdateRelease(releaseId)
  const { data: burndown, isLoading: burndownLoading } = useReleaseBurndown(releaseId)

  const [activeTab, setActiveTab] = useState<TabKey>('details')

  // Broadcom-Rally-style deferred save (matches the Work Item + Timebox detail
  // pages): every field edit — title, dates, velocity/estimate, version, theme/
  // notes rich text, lifecycle state — accumulates locally and commits together
  // via the floating Save/Cancel bar, instead of auto-saving each field on blur.
  const {
    value: vrel,
    isDirty,
    saving,
    setField,
    save,
    cancel,
  } = usePendingPatch<Release, UpdateReleaseInput>(
    release ?? ({} as Release),
    releaseId,
    async (patch) => {
      try {
        return await update.mutateAsync(patch)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('detail.updateFailed'))
        throw err
      }
    },
  )

  function handleSave() {
    if (!(vrel.name ?? '').trim()) {
      toast.error(t('create.nameRequired'))
      return
    }
    if (vrel.startDate && vrel.releaseDate && vrel.releaseDate < vrel.startDate) {
      toast.error(t('create.dateOrder'))
      return
    }
    void save().catch(() => {})
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    )
  }

  if (isError || !release) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background">
        <p className="text-ui-lg text-muted-foreground">{t('detailPage.loadError')}</p>
        <Link to="/releases" className="text-ui-md font-semibold text-primary hover:underline">
          {t('detailPage.backToReleases')}
        </Link>
      </div>
    )
  }

  const rollup = release.taskRollup

  const TABS = [
    { key: 'details', label: t('detailPage.tabs.details'), icon: <FileText size={19} /> },
    { key: 'artifacts', label: t('detailPage.tabs.artifacts'), icon: <Package size={19} /> },
  ]

  return (
    <DetailLayout
      onBack={() => void navigate({ to: '/releases' })}
      badge={<TypeBadge type="release" />}
      itemKey={release.releaseKey}
      title={
        canManage ? (
          <input
            value={vrel.name ?? ''}
            onChange={(e) => setField({ name: e.target.value })}
            className="w-72 rounded border-0 bg-transparent px-1 py-0.5 text-base font-semibold text-white placeholder-white/60 focus:bg-white/10 focus:outline-none"
            aria-label={t('common:name')}
          />
        ) : (
          release.name
        )
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as TabKey)}
    >
      {activeTab === 'artifacts' ? (
        <ReleaseArtifactsTab releaseId={releaseId} />
      ) : (
        <DetailTwoPane
          sidebarTitle={t('detailPage.metadataTitle')}
          main={
            <>
              <RichTextEditor
                title={t('detailPage.themeTitle')}
                value={vrel.theme}
                minHeight={100}
                readOnly={!canManage}
                onChange={(html) => setField({ theme: html || null })}
              />
              <RichTextEditor
                title={t('detailPage.notesTitle')}
                value={vrel.notes}
                minHeight={140}
                readOnly={!canManage}
                onChange={(html) => setField({ notes: html || null })}
              />
              {/* Release Notes — separate from Theme/Notes (P3-REL-FR-034). */}
              <RichTextEditor
                title={t('detailPage.releaseNotesTitle', 'Release Notes')}
                value={vrel.releaseNotes}
                minHeight={120}
                readOnly={!canManage}
                onChange={(html) => setField({ releaseNotes: html || null })}
              />
            </>
          }
          sidebar={
            <>
              <div className="space-y-4">
                <DetailField label={t('detailPage.projectScope')}>
                  <DetailReadonlyValue>{project?.projectName ?? '—'}</DetailReadonlyValue>
                </DetailField>

                <DetailField label={t('detailPage.lifecycleState')}>
                  <SearchableSelect
                    variant="field"
                    value={(vrel.state ?? vrel.status) as ReleaseStatus}
                    readOnly={!canManage}
                    ariaLabel={t('detailPage.lifecycleState')}
                    options={RELEASE_STATES.map((st) => ({
                      value: st,
                      label: RELEASE_STATUS_STYLE[st].label,
                    }))}
                    onChange={(v) => setField({ state: v as ReleaseStatus })}
                  />
                </DetailField>

                <DetailFieldPair>
                  <DetailField label={t('detail.startDateLabel')}>
                    <DateField
                      variant="field"
                      value={vrel.startDate || null}
                      readOnly={!canManage}
                      ariaLabel={t('detail.startDateLabel')}
                      onChange={canManage ? (v) => setField({ startDate: v }) : undefined}
                    />
                  </DetailField>

                  <DetailField label={t('detail.releaseDateLabel')}>
                    <DateField
                      variant="field"
                      value={vrel.releaseDate || null}
                      readOnly={!canManage}
                      ariaLabel={t('detail.releaseDateLabel')}
                      onChange={canManage ? (v) => setField({ releaseDate: v }) : undefined}
                    />
                  </DetailField>
                </DetailFieldPair>

                <DetailFieldPair>
                  <DetailField label={t('detail.plannedVelocityLabel')}>
                    {canManage ? (
                      <Input
                        type="number"
                        min={0}
                        value={vrel.plannedVelocity ?? ''}
                        onChange={(e) =>
                          setField({
                            plannedVelocity: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        placeholder="0"
                      />
                    ) : (
                      <DetailReadonlyValue mono>{vrel.plannedVelocity ?? '—'}</DetailReadonlyValue>
                    )}
                  </DetailField>

                  <DetailField label={t('detail.planEstimateLabel')}>
                    {canManage ? (
                      <Input
                        type="number"
                        min={0}
                        value={vrel.planEstimate ?? ''}
                        onChange={(e) =>
                          setField({
                            planEstimate: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        placeholder="0"
                      />
                    ) : (
                      <DetailReadonlyValue mono>{vrel.planEstimate ?? '—'}</DetailReadonlyValue>
                    )}
                  </DetailField>
                </DetailFieldPair>

                <DetailField label={t('detailPage.versionTag')}>
                  {canManage ? (
                    <Input
                      value={vrel.version ?? ''}
                      onChange={(e) => setField({ version: e.target.value || null })}
                      placeholder="e.g. v2.4.0"
                    />
                  ) : (
                    <DetailReadonlyValue>{vrel.version || '—'}</DetailReadonlyValue>
                  )}
                </DetailField>
              </div>

              {rollup && <TaskRollupPanel rollup={rollup} />}

              <BurndownPanel burndown={burndown} loading={burndownLoading} />
            </>
          }
        />
      )}
      {activeTab === 'details' && (
        <SaveCancelBar
          visible={isDirty && canManage}
          saving={saving}
          errorMsg={null}
          onSave={handleSave}
          onCancel={cancel}
        />
      )}
    </DetailLayout>
  )
}
