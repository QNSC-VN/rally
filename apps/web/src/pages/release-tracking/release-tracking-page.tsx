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
import { reportScopeLabel } from '@/features/reporting/scope'
import { EmptyState } from '@/shared/ui/empty-state'
import { NativeSelect } from '@/shared/ui/native-select'
import { MetricCard } from '@/shared/ui/metric-card'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/ui/page-header'
import { TimeboxPicker } from '@/shared/ui/timebox-picker'

import { ReleaseBurnup } from './ui/release-burnup'
import { TrackingGrid } from './ui/tracking-grid'

const BUCKETS: ReleaseBucket[] = ['direct', 'derived', 'unparented']

export function ReleaseTrackingPage() {
  const { t } = useTranslation(['release-tracking', 'common'])
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

  // Paging lives here because this component owns the query. The rows are now a SERVER page:
  // the endpoint classifies and totals over the whole population, then returns one slice, so
  // switching page refetches rather than re-slicing something already in memory.
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  // A bucket switch changes the population; page 3 of the old bucket means nothing in the new.
  const pageResetKey = `${releaseId ?? ''}|${bucket}|${pageSize}`
  const [syncedPageKey, setSyncedPageKey] = useState(pageResetKey)
  if (syncedPageKey !== pageResetKey) {
    setSyncedPageKey(pageResetKey)
    setPage(1)
  }

  const { data, isLoading, isError } = useReleaseTracking({
    projectId,
    teamId,
    releaseId: releaseId ?? undefined,
    unit,
    bucket,
    page,
    pageSize,
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
  /**
   * The read-only scope line.
   *
   * `All Teams` where there is no Team, not an empty string after a separator: All Teams is the
   * DEFAULT scope (RT-BR-01 names it), so the page's first render printed "NextGen Platform · " and
   * left the reader to guess whether the Team was still loading.
   */
  const scope = data
    ? reportScopeLabel(data.context.projectName, data.context.teamName, t('common:allTeams'))
    : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <PageHeader
        title={t('title')}
        /* Project/Team is read-only CONTEXT (RT-AC-02 forbids a second filter here), and it sat in
           `actions` between the Release picker and the Chart Unit selector — a plain text span in a
           row of controls, which is where a reader looks for one. `PageHeader` has a subtitle slot for
           exactly this. */
        subtitle={scope}
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
            {/* Each tile is a `MetricCard`, so the three bucket counts read like every other KPI in
                the app: label above value, `text-ui-*` scale, one set of colour tokens. They were
                hand-rolled the other way up with a raw `text-xl`, which made this the only summary in
                Rally where the number came first.

                Still BUTTONS: the tiles are the bucket selector (§5.1), so the pressed one is stated
                with `aria-pressed` rather than by colour alone. `MetricStrip` is deliberately NOT used
                — that is the 58px bar under a page header, and these sit inside a panel. */}
            <div className="flex items-stretch">
              {BUCKETS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBucket(key)}
                  aria-pressed={bucket === key}
                  className={`flex-1 border-r border-border-inner px-3 py-1 last:border-r-0 ${
                    bucket === key ? 'bg-accent-bg' : 'hover:bg-surface-hover'
                  }`}
                >
                  <MetricCard
                    label={t(`summary.${key}`)}
                    /* `--`, not `0`. `data` is undefined while the request is in flight and after it
                       fails, and three large zeros beside the grid's error state read as "this release
                       has no Features" — a data conclusion drawn from a network fault. */
                    value={summary ? summary[key] : EMPTY_VALUE}
                    minWidth={0}
                  />
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
                  {`${t(`summary.${key}`)} (${summary ? summary[key] : EMPTY_VALUE})`}
                </option>
              ))}
            </NativeSelect>
            <TrackingGrid
              report={data}
              bucket={bucket}
              unit={unit}
              isLoading={isLoading}
              isError={isError}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
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
