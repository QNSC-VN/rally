/**
 * Portfolio > Release Tracking (RT §5).
 *
 * Two panes: the three mutually exclusive summary buckets plus the active bucket's list on the
 * left, the burnup and its three totals on the right. One Release selector and one `Chart Unit`
 * selector in the header — and no Project or Team control, because those come from the global
 * workspace context and RT-AC-02 forbids a second filter here.
 *
 * `Breakdown` and `Dependencies` are not exposed as active views (RT-AC-12): Breakdown is not in
 * the approved slice at all, and Dependencies is future work (`FB-P6-001`), so it appears only as
 * a disabled marker that cannot be mistaken for a working tab.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useReleases } from '@/features/releases/api'
import { useReleaseTracking, type ChartUnit, type ReleaseBucket } from '@/features/reporting/api'
import { EmptyState } from '@/shared/ui/empty-state'
import { NativeSelect } from '@/shared/ui/native-select'
import { PageHeader } from '@/shared/ui/page-header'
import { TimeboxPicker } from '@/shared/ui/timebox-picker'

import { ReleaseBurnup } from './ui/release-burnup'
import { TrackingGrid } from './ui/tracking-grid'

const BUCKETS: ReleaseBucket[] = ['direct', 'derived', 'unparented']

export function ReleaseTrackingPage() {
  const { t } = useTranslation('release-tracking')
  const { project, team } = useAppContext()
  const projectId = project?.projectId
  const teamId = team?.teamId

  const { data: releases = [] } = useReleases(projectId)
  const [chosenReleaseId, setChosenReleaseId] = useState<string | null>(null)
  const releaseId =
    chosenReleaseId && releases.some((release) => release.id === chosenReleaseId)
      ? chosenReleaseId
      : (releases[0]?.id ?? null)

  const [unit, setUnit] = useState<ChartUnit>('points')
  const [bucket, setBucket] = useState<ReleaseBucket>('direct')

  const { data, isLoading } = useReleaseTracking({
    projectId,
    teamId,
    releaseId: releaseId ?? undefined,
    unit,
    bucket,
  })

  if (!projectId) {
    return (
      <div className="flex-1 bg-background p-6">
        <EmptyState title={t('selectProject')} />
      </div>
    )
  }

  if (releases.length === 0) {
    // "No Release in the selected Project: show an explicit no-Release state; do not reuse
    // another Project's Release" (§5.1).
    return (
      <div className="flex-1 bg-background p-6">
        <EmptyState
          title={t('empty.noRelease.title')}
          description={t('empty.noRelease.description')}
        />
      </div>
    )
  }

  const summary = data?.summary
  const scope = data ? `${data.context.projectName} · ${data.context.teamName ?? ''}` : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <PageHeader
        title={t('title')}
        actions={
          <div className="flex items-center gap-4">
            <TimeboxPicker
              items={releases.map((release) => ({
                id: release.id,
                name: release.name,
                startDate: release.startDate ?? null,
                endDate: release.releaseDate ?? null,
              }))}
              selectedId={releaseId}
              onSelect={setChosenReleaseId}
              emptyLabel={t('picker.empty')}
              noneLabel={t('picker.none')}
              prevLabel={t('picker.prev')}
              nextLabel={t('picker.next')}
              minWidth={240}
            />
            {/* Project/Team is read-only CONTEXT here, never a control. */}
            <span className="text-ui-xs text-muted-foreground">{scope}</span>
            <label className="flex items-center gap-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
              {t('chartUnit')}
              <NativeSelect
                value={unit}
                onChange={(event) => setUnit(event.target.value as ChartUnit)}
                aria-label={t('chartUnit')}
              >
                <option value="points">{t('unit.points')}</option>
                <option value="count">{t('unit.count')}</option>
              </NativeSelect>
            </label>
            <span
              className="flex items-center gap-1.5 text-ui-xs text-foreground-disabled"
              title={t('views.dependenciesHint')}
            >
              <GitBranch size={12} />
              {t('views.dependencies')}
            </span>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-4">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded border border-border-strong bg-card p-4">
            <p className="mb-3 text-ui-sm font-semibold text-foreground">{t('summary.title')}</p>
            {/* All three totals stay visible even when the active bucket is empty (§5.1), and
                clicking one switches the list — the tiles ARE the bucket selector. */}
            <div className="flex items-stretch">
              {BUCKETS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBucket(key)}
                  aria-pressed={bucket === key}
                  className={`flex-1 border-r border-border-inner px-2 py-1 text-center last:border-r-0 ${
                    bucket === key ? 'bg-accent-bg' : 'hover:bg-surface-hover'
                  }`}
                >
                  <span className="block text-xl font-semibold text-foreground tabular-nums">
                    {summary?.[key] ?? 0}
                  </span>
                  <span className="mt-1 block text-ui-xs font-semibold text-muted-foreground">
                    {t(`summary.${key}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded border border-border-strong bg-card p-4">
            <NativeSelect
              value={bucket}
              onChange={(event) => setBucket(event.target.value as ReleaseBucket)}
              aria-label={t('summary.title')}
              className="mb-2 max-w-[280px]"
            >
              {BUCKETS.map((key) => (
                <option key={key} value={key}>
                  {`${t(`summary.${key}`)} (${summary?.[key] ?? 0})`}
                </option>
              ))}
            </NativeSelect>
            <TrackingGrid report={data} bucket={bucket} unit={unit} isLoading={isLoading} />
          </div>
        </div>

        <ReleaseBurnup
          projectId={projectId}
          teamId={teamId}
          releaseId={releaseId ?? undefined}
          releaseName={data?.release.name ?? ''}
          releaseStart={data?.release.startDate ?? null}
          releaseEnd={data?.release.releaseDate ?? null}
          unit={unit}
          totals={data?.totals}
        />
      </div>
    </div>
  )
}
