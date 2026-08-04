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
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useReleases } from '@/features/releases/api'
import { useProjectTeams } from '@/features/teams/api'
import { useReleaseTracking, type ChartUnit, type ReleaseBucket } from '@/features/reporting/api'
import { EmptyState } from '@/shared/ui/empty-state'
import { CompactSelect } from '@/shared/ui/native-select'
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
  /**
   * Team id → key, for the grid's team chips: the report names teams but carries no keys, and initials
   * would draw a different glyph from the one the same team shows on every other page.
   */
  const { data: projectTeams = [] } = useProjectTeams(projectId)
  const teamKeyOf = useCallback(
    (teamId: string | null | undefined) =>
      teamId == null ? null : (projectTeams.find((tm) => tm.id === teamId)?.key ?? null),
    [projectTeams],
  )
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
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <PageHeader
        title={t('title')}
        /**
         * The Release picker sits BESIDE the title, as Rally puts it — `Release Tracking  ‹ 2026Q3
         * 2026-06-24 - 2026-09-29 ›` — rather than across the bar in `actions`. It is what the page is
         * about, not one control among several: §239 lists it first in the header contract.
         */
        badge={
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
        }
        /**
         * No Project/Team line here. §239 wants the scope "displayed as read-only context", and it is —
         * in the app shell's own context switcher, where Rally shows it too and where it applies to
         * every page. Repeating it beside this one title said the same thing twice, and read as a
         * filter belonging to the page (which RT-AC-02 forbids).
         */
        actions={
          <div className="flex items-center gap-4">
            {/* One line: `CHART UNIT [Points]`. The label wrapped onto two rows at this width, which
                pushed the bar taller than every other page's, and `CompactSelect` is the toolbar-scale
                control that exists for exactly this — `NativeSelect`'s `px-3 py-2` is a form size. */}
            <label className="flex items-center gap-2 text-ui-xs font-semibold tracking-wide whitespace-nowrap text-foreground-subtle uppercase">
              {t('chartUnit')}
              <CompactSelect
                value={unit}
                onChange={(event) => setUnit(event.target.value as ChartUnit)}
                aria-label={t('chartUnit')}
              >
                <option value="points">{t('unit.points')}</option>
                <option value="count">{t('unit.count')}</option>
              </CompactSelect>
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
                    // Rally's tile: the NUMBER first and centred, its label under it. These three are read
                    // as one comparison and each is a button, so the figure leads.
                    layout="value-first"
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

          <div className="flex min-h-0 flex-1 flex-col rounded border border-border-strong bg-card">
            <TrackingGrid
              report={data}
              teamKeyOf={teamKeyOf}
              bucket={bucket}
              unit={unit}
              /* Into the grid's TOOLBAR, opposite the search — one row, as Rally lays it out. It used to
                 sit on its own row above the panel, reading as a filter for the card rather than the
                 selector for the list beneath it. `CompactSelect` because a toolbar row is not a form. */
              bucketPicker={
                <CompactSelect
                  value={bucket}
                  onChange={(event) => setBucket(event.target.value as ReleaseBucket)}
                  aria-label={t('summary.title')}
                  className="max-w-[280px]"
                >
                  {BUCKETS.map((key) => (
                    <option key={key} value={key}>
                      {`${t(`summary.${key}`)} (${summary ? summary[key] : EMPTY_VALUE})`}
                    </option>
                  ))}
                </CompactSelect>
              }
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
