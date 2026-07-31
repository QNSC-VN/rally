/**
 * Capacity Planning — the list of plans for the current project.
 *
 * Laid out as Rally's own Capacity Planning list: an `Oldest Release` / `Newest Release` pair
 * beside the title, `Show Filters` / `Show Fields`, and a grid led by a linked ID column. No KPI
 * strip — Rally has none here, and "1 plan, 1 draft, 0 published" restated what three rows of the
 * table already said.
 *
 * Single-project, unlike the Portfolio list: a plan belongs to exactly one project and the API
 * requires `projectId`, so this page gates on the selected project the way Releases and Iterations
 * do and shows a prompt when none is chosen.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarRange, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { EmptyState } from '@/shared/ui/empty-state'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { ListPageScaffold } from '@/shared/ui/list-page/list-page-scaffold'
import { ListPageHeader } from '@/shared/ui/list-page/list-page-header'
import { InlineSelect } from '@/shared/ui/native-select'
import { TimeboxPicker } from '@/shared/ui/timebox-picker'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { useDataTable } from '@/shared/ui/table'
import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { type RowSelection } from '@/shared/lib/hooks/use-row-selection'
import { notify } from '@/shared/lib/toast'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useReleases } from '@/features/releases/api'
import {
  useCapacityPlans,
  useDeleteCapacityPlan,
  CAPACITY_PLAN_STATUSES,
  CAPACITY_PLAN_UNITS,
  type CapacityPlan,
  type CapacityPlanStatus,
  type CapacityPlanUnit,
} from '@/features/capacity-planning/api'
import { CAPACITY_PLAN_COLUMNS, type PlanColKey } from './model/columns'
import { CreateCapacityPlanModal } from './ui/create-capacity-plan-modal'
import { CapacityPlanRow } from './ui/capacity-plan-row'

export function CapacityPlansPage() {
  const { t } = useTranslation('capacity')
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canManage = can('capacity:manage')

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  /** Rally's release WINDOW: both ends optional, and either one alone still narrows. */
  const [oldestReleaseId, setOldestReleaseId] = useState('')
  const [newestReleaseId, setNewestReleaseId] = useState('')
  const [statusFilter, setStatusFilter] = useState<CapacityPlanStatus | 'all'>('all')
  const [unitFilter, setUnitFilter] = useState<CapacityPlanUnit | 'all'>('all')

  const table = useDataTable<CapacityPlan, unknown, PlanColKey>(CAPACITY_PLAN_COLUMNS, {
    storageKey: STORAGE_KEYS.CAPACITY_PLAN_COLUMNS,
    leadingWidth: 36,
  })
  const colStyleFor = useCallback(
    (key: PlanColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
  )

  const { data: plans = [], isLoading, isError } = useCapacityPlans(projectId)
  const { data: releases = [] } = useReleases(projectId)
  const deletePlan = useDeleteCapacityPlan()

  /**
   * Releases oldest-first — the order both range selects offer and the order the window is
   * measured in.
   *
   * By START date, not name: "2025Q4" sorts after "2025Q10" as text, and a release named for a
   * quarter is not the only naming scheme a project may use. Releases with no start date sort last
   * rather than being dropped, so a plan against one is still selectable as an endpoint.
   */
  const releasesOldestFirst = useMemo(
    () =>
      [...releases].sort((a, b) => {
        if (a.startDate === b.startDate) return a.name.localeCompare(b.name)
        if (a.startDate === null) return 1
        if (b.startDate === null) return -1
        return a.startDate < b.startDate ? -1 : 1
      }),
    [releases],
  )

  /**
   * What both pickers offer: an explicit `None` row plus every release, oldest first.
   *
   * `None` is an option rather than a "clear" affordance because the picker's prev/next arrows
   * walk the same list — an unbounded end has to be reachable by stepping, not only by a menu.
   */
  const releaseOptions = useMemo(
    () => [
      { id: '', name: t('filters.noneRelease'), startDate: null, endDate: null },
      ...releasesOldestFirst.map((r) => ({
        id: r.id,
        name: r.name,
        startDate: r.startDate,
        endDate: r.releaseDate,
      })),
    ],
    [releasesOldestFirst, t],
  )

  /**
   * The release cell's options — the same `RE-<n>: Name` + glyph shape the Backlog's Release
   * column offers, built once here rather than per row.
   */
  const releaseCellOptions = useMemo(
    () =>
      releasesOldestFirst.map((r) => ({
        value: r.id,
        label: r.releaseKey ? `${r.releaseKey}: ${r.name}` : r.name,
        searchText: `${r.releaseKey ?? ''} ${r.name}`,
        icon: <TypeBadge type="release" size={16} />,
      })),
    [releasesOldestFirst],
  )

  const releaseRank = useMemo(
    () => new Map(releasesOldestFirst.map((r, index) => [r.id, index])),
    [releasesOldestFirst],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const from = oldestReleaseId === '' ? null : (releaseRank.get(oldestReleaseId) ?? null)
    const to = newestReleaseId === '' ? null : (releaseRank.get(newestReleaseId) ?? null)

    return plans.filter((p) => {
      if (q) {
        const matches =
          p.name.toLowerCase().includes(q) ||
          (p.releaseName ?? '').toLowerCase().includes(q) ||
          (p.planKey ?? '').toLowerCase().includes(q)
        if (!matches) return false
      }
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (unitFilter !== 'all' && p.unit !== unitFilter) return false
      if (from === null && to === null) return true
      // A plan whose release is not in this project's release list cannot be placed in the
      // window, so a set window excludes it rather than silently keeping it.
      const rank = releaseRank.get(p.releaseId)
      if (rank === undefined) return false
      if (from !== null && rank < from) return false
      if (to !== null && rank > to) return false
      return true
    })
  }, [plans, search, oldestReleaseId, newestReleaseId, releaseRank, statusFilter, unitFilter])

  const { sortField, sortDir, toggle } = useTableSort<PlanColKey>()
  const sorted = useMemo(() => {
    if (!sortField) return filtered
    const dir = sortDir === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, string | number | null>)[sortField] ?? ''
      const bv = (b as unknown as Record<string, string | number | null>)[sortField] ?? ''
      if (av < bv) return -dir
      if (av > bv) return dir
      return 0
    })
  }, [filtered, sortField, sortDir])

  /**
   * Counts what the `Filters` toggle badges — the release window is NOT in it.
   *
   * The window has its own always-visible boxes in the header (as in Rally), so counting it here
   * would badge a filter the reader can already see and would auto-open a panel that adds nothing.
   */
  const activeFilterCount = (statusFilter === 'all' ? 0 : 1) + (unitFilter === 'all' ? 0 : 1)
  const isNarrowed =
    activeFilterCount > 0 || oldestReleaseId !== '' || newestReleaseId !== '' || search !== ''

  /**
   * Only DRAFTS are deleted. The server refuses a published plan (its writes have to be reverted
   * first), so the ones that cannot go are skipped here with a message rather than each producing
   * its own failed request.
   */
  async function handleBulkDelete(selection: RowSelection) {
    const chosen = plans.filter((p) => selection.selectedIds.has(p.id))
    const drafts = chosen.filter((p) => p.status === 'draft')
    const published = chosen.length - drafts.length
    try {
      await Promise.all(drafts.map((p) => deletePlan.mutateAsync(p.id)))
      if (drafts.length > 0) notify.success(t('delete.bulkDone', { count: drafts.length }))
      if (published > 0) notify.error(t('delete.publishedSkipped', { count: published }))
      selection.clear()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('delete.failed'))
    } finally {
      setConfirmBulkDelete(false)
    }
  }

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <p className="text-ui-lg text-foreground-subtle">{t('selectProject')}</p>
      </div>
    )
  }

  return (
    <>
      <ListPageScaffold<CapacityPlan, PlanColKey>
        header={
          <ListPageHeader
            title={t('title')}
            accessory={
              /* Rally's `Oldest Release` / `Newest Release` pair, in the SAME boxed
                 prev / dropdown / next control the Team Board and Reports use for iterations —
                 a release is the same shape (a name plus a date range), so it is the same
                 component rather than a second style of timebox selector.
                 `None` is a real option at both ends, which is how the window opens unbounded. */
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
                  {t('filters.oldestRelease')}
                  <TimeboxPicker
                    items={releaseOptions}
                    selectedId={oldestReleaseId}
                    onSelect={setOldestReleaseId}
                    emptyLabel={t('filters.noneRelease')}
                    noneLabel={t('filters.noReleases')}
                    prevLabel={t('filters.olderRelease')}
                    nextLabel={t('filters.newerRelease')}
                    minWidth={200}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
                  {t('filters.newestRelease')}
                  <TimeboxPicker
                    items={releaseOptions}
                    selectedId={newestReleaseId}
                    onSelect={setNewestReleaseId}
                    emptyLabel={t('filters.noneRelease')}
                    noneLabel={t('filters.noReleases')}
                    prevLabel={t('filters.olderRelease')}
                    nextLabel={t('filters.newerRelease')}
                    minWidth={200}
                  />
                </label>
              </div>
            }
          />
        }
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('searchPlaceholder'),
          ariaLabel: t('searchPlaceholder'),
          width: 200,
        }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={13} /> {t('common:addNew')}
            </Button>
          ) : undefined
        }
        activeFilterCount={activeFilterCount}
        filters={
          /* Rally's `Show Filters` panel. The two selects are the list's own non-column facets:
             Status and Unit. Same `InlineSelect`-in-a-label shape Releases and Timeboxes use, so
             a filter row reads identically wherever it appears. */
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
              {t('common:status')}
              <InlineSelect
                value={statusFilter}
                aria-label={t('filters.byStatus')}
                onChange={(e) => setStatusFilter(e.target.value as CapacityPlanStatus | 'all')}
                className="w-auto"
              >
                <option value="all">{t('filters.allStatuses')}</option>
                {CAPACITY_PLAN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`statuses.${status}`)}
                  </option>
                ))}
              </InlineSelect>
            </label>
            <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
              {t('fields.unit')}
              <InlineSelect
                value={unitFilter}
                aria-label={t('filters.byUnit')}
                onChange={(e) => setUnitFilter(e.target.value as CapacityPlanUnit | 'all')}
                className="w-auto"
              >
                <option value="all">{t('filters.allUnits')}</option>
                {CAPACITY_PLAN_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`units.${unit}`)}
                  </option>
                ))}
              </InlineSelect>
            </label>
          </div>
        }
        /* Rally prints a running total on the right of this bar. It counts what the grid is
           SHOWING, not what the project has, so a filtered list says how much it left out. */
        trailing={
          <span className="text-ui-sm whitespace-nowrap text-muted-foreground">
            {t('totalPlans', { count: sorted.length })}
          </span>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
        bulkActions={
          canManage
            ? (selection) => (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(true)}
                    disabled={deletePlan.isPending}
                    className="flex items-center gap-1 rounded px-2 py-1 text-ui-sm font-medium text-destructive transition-colors hover:bg-card disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    {t('common:delete')}
                  </button>
                  <ConfirmDialog
                    open={confirmBulkDelete}
                    title={t('delete.title')}
                    message={t('delete.bulkMessage', { count: selection.count })}
                    confirmLabel={t('delete.confirm')}
                    destructive
                    pending={deletePlan.isPending}
                    onConfirm={() => void handleBulkDelete(selection)}
                    onCancel={() => setConfirmBulkDelete(false)}
                  />
                </>
              )
            : undefined
        }
        headerProps={table.headerProps}
        headerColumns={table.headerColumns}
        colStyles={table.colStyles}
        sort={{
          col: sortField ?? '',
          dir: sortDir ?? 'asc',
          onSort: (c) => toggle(c as PlanColKey),
        }}
        items={sorted}
        loading={isLoading}
        skeleton={{ rows: 6, cols: 7 }}
        error={
          isError ? (
            <EmptyState
              icon={<AlertTriangle size={28} className="text-destructive" />}
              title={t('loadError')}
            />
          ) : undefined
        }
        empty={
          sorted.length === 0 ? (
            <EmptyState
              icon={<CalendarRange size={32} className="text-border-strong" />}
              title={isNarrowed ? t('emptySearch') : t('empty')}
            />
          ) : undefined
        }
        renderRow={(plan, { gutter }) => (
          <CapacityPlanRow
            key={plan.id}
            plan={plan}
            canManage={canManage}
            releaseOptions={releaseCellOptions}
            colStyleFor={colStyleFor}
            gutter={gutter}
          />
        )}
      />

      {showCreate && (
        <CreateCapacityPlanModal projectId={projectId} onClose={() => setShowCreate(false)} />
      )}
    </>
  )
}
