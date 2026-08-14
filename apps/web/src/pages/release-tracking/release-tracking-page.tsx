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

import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useReleases } from '@/features/releases/api'
import { listResource } from '@/shared/lib/query/resource'
import { useProjectTeams } from '@/features/teams/api'
import { useReleaseTracking, type ChartUnit, type ReleaseBucket } from '@/features/reporting/api'
import { EmptyState } from '@/shared/ui/empty-state'
import { CompactSelect } from '@/shared/ui/native-select'
import { MetricCard } from '@/shared/ui/metric-card'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/ui/page-header'
import { TimeboxPicker } from '@/shared/ui/timebox-picker'
import { Tooltip } from '@/shared/ui/tooltip'

import { ReleaseBurnup } from './ui/release-burnup'
import { TrackingGrid } from './ui/tracking-grid'

const BUCKETS: ReleaseBucket[] = ['direct', 'derived', 'unparented']

export function ReleaseTrackingPage() {
  const { t } = useTranslation(['release-tracking', 'common'])
  const { project, team } = useAppContext()
  const projectId = project?.projectId
  const teamId = team?.teamId

  /**
   * The release feed is a RESOURCE, not `data ?? []`, and this page is the reason the seam exists.
   *
   * `const { data: releases = [] } = useReleases(projectId)` discarded both `isError` and
   * `isLoading`, so a 500, a 403 or a cold load made `releases.length === 0` true and the
   * `§5.1` branch below asserted *"No releases in this project — Create one under Plan >
   * Timeboxes to track it here."* That is a fabricated fact AND a wrong call to action, from a
   * network fault, directly under a comment quoting the requirement it violates. `phase` keeps
   * "the server said none" and "the server did not answer" apart.
   */
  const releasesQuery = useReleases(projectId)
  const releaseFeed = listResource(releasesQuery)
  const releases = releaseFeed.rows
  /**
   * Team id → key, for the grid's team chips: the report names teams but carries no keys, and initials
   * would draw a different glyph from the one the same team shows on every other page.
   *
   * Left as a plain default deliberately: a failed roster costs a team CHIP its key, which renders
   * `null` and falls back to the team name the report already carries. Nothing on screen becomes
   * false, so this is decoration, not a measurement.
   */
  const { data: projectTeams = [] } = useProjectTeams(projectId)
  const teamKeyOf = useCallback(
    (teamId: string | null | undefined) =>
      teamId == null ? null : (projectTeams.find((tm) => tm.id === teamId)?.key ?? null),
    [projectTeams],
  )
  // Persist Release Tracking view selections across reload (P6-COM-006).
  const [chosenReleaseId, setChosenReleaseId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEYS.RELEASE_TRACKING_RELEASE),
  )
  function chooseRelease(id: string | null) {
    setChosenReleaseId(id)
    if (id) localStorage.setItem(STORAGE_KEYS.RELEASE_TRACKING_RELEASE, id)
    else localStorage.removeItem(STORAGE_KEYS.RELEASE_TRACKING_RELEASE)
  }
  const releaseId =
    chosenReleaseId && releases.some((release) => release.id === chosenReleaseId)
      ? chosenReleaseId
      : (releases[0]?.id ?? null)

  const [unit, setUnit] = useState<ChartUnit>(() => {
    const s = localStorage.getItem(STORAGE_KEYS.RELEASE_TRACKING_UNIT)
    return s === 'points' || s === 'count' ? (s as ChartUnit) : 'points'
  })
  function changeUnit(next: ChartUnit) {
    setUnit(next)
    localStorage.setItem(STORAGE_KEYS.RELEASE_TRACKING_UNIT, next)
  }

  const [bucket, setBucket] = useState<ReleaseBucket>(() => {
    const s = localStorage.getItem(STORAGE_KEYS.RELEASE_TRACKING_BUCKET)
    return s === 'direct' || s === 'derived' || s === 'unparented' ? (s as ReleaseBucket) : 'direct'
  })
  function changeBucket(next: ReleaseBucket) {
    setBucket(next)
    localStorage.setItem(STORAGE_KEYS.RELEASE_TRACKING_BUCKET, next)
  }

  /**
   * Search and sort live here, with paging, because this component owns the query.
   *
   * All three are SERVER-side: the endpoint classifies the whole population, then searches, sorts
   * and slices it (§259 "Search applies within the active bucket", RT-AC-05's two-directional sort
   * on Rank/ID/Team). The grid used to do both over `report.rows` — one page — so `ID ▼` ordered
   * whichever 25 rows had arrived.
   *
   * `useTableSort` seeded with RT-AC-04's default (`rank`, ascending), so a new column starts
   * ascending exactly as it does on every other grid in the app.
   */
  const [search, setSearch] = useState('')
  const {
    sortField: sortCol,
    sortDir,
    toggle: toggleSort,
  } = useTableSort<string>({ field: 'rank', dir: 'asc' })

  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  // A bucket switch changes the population; page 3 of the old bucket means nothing in the new. So
  // does a new search term or a new sort — page 3 of the previous order is a different set of rows.
  const pageResetKey = `${releaseId ?? ''}|${bucket}|${pageSize}|${search}|${sortCol}:${sortDir}`
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
    q: search.trim() || undefined,
    // `rank:asc` is the server's own default, so it is omitted rather than sent — one cache key for
    // the default view instead of two that mean the same thing.
    sort: sortCol === 'rank' && sortDir === 'asc' ? undefined : `${sortCol}:${sortDir ?? 'asc'}`,
  })

  if (!projectId) {
    return (
      <div className="flex-1 bg-background p-6">
        <EmptyState title={t('selectProject')} />
      </div>
    )
  }

  // Before the §5.1 branch, because a failed feed is not an empty project. Note the ORDER is what
  // makes this safe: `phase` is one discriminant, so `error` cannot also be `empty`.
  if (releaseFeed.phase === 'error') {
    return (
      <div className="flex-1 bg-background p-6">
        <EmptyState
          title={t('releaseFeedError.title')}
          description={t('releaseFeedError.description')}
        />
      </div>
    )
  }

  if (releaseFeed.phase === 'empty') {
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
            onSelect={chooseRelease}
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
                onChange={(event) => changeUnit(event.target.value as ChartUnit)}
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
            {/* Each tile carries its own definition on hover.
                The three-way classification is the page's central idea and the least guessable
                thing on it — "Derived" in particular is a Feature that is NOT in this release, and
                its bare count with no percentage reads as a missing number rather than a
                deliberate one (RT-BR-05). The approved mockup had an AlertCircle popover for this
                and the build dropped it (audit §6.6).
                On the tiles rather than a separate icon: the tiles already ARE the bucket selector,
                so the definition belongs on the thing you are choosing between. The wording is
                Rally's own, now that the taxonomy is confirmed to be Rally's near-verbatim.
                See 09_Gap_Audit/PHASE_5_6_DECISION_MATRIX.md#P6-RT-10 */}
            <div className="flex items-stretch">
              {BUCKETS.map((key) => (
                <Tooltip key={key} content={t(`summary.help.${key}`)} side="bottom">
                  <button
                    type="button"
                    onClick={() => changeBucket(key)}
                    aria-pressed={bucket === key}
                    className={`flex-1 border-r border-border-inner px-3 py-1 last:border-r-0 ${
                      bucket === key ? 'bg-accent-bg' : 'hover:bg-surface-hover'
                    }`}
                  >
                    <MetricCard
                      // Rally's tile: the NUMBER first and centred, its label under it. These three are
                      // read as one comparison and each is a button, so the figure leads.
                      layout="value-first"
                      label={t(`summary.${key}`)}
                      /* `--`, not `0`. `data` is undefined while the request is in flight and after it
                         fails, and three large zeros beside the grid's error state read as "this release
                         has no Features" — a data conclusion drawn from a network fault. */
                      value={summary ? summary[key] : EMPTY_VALUE}
                      minWidth={0}
                    />
                  </button>
                </Tooltip>
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
                  onChange={(event) => changeBucket(event.target.value as ReleaseBucket)}
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
              search={search}
              onSearchChange={setSearch}
              // `?? 'asc'`: the hook reports a null direction only while nothing is sorted, which
              // cannot happen here (it is seeded), but the header's contract wants a concrete one.
              sortCol={sortCol ?? 'rank'}
              sortDir={sortDir ?? 'asc'}
              onSort={toggleSort}
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
