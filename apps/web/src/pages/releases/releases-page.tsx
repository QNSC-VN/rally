/**
 * Releases — P3.2 Release Management
 *
 * Dense dashboard with inline-editable rows. Status values: Planning, Active, Accepted.
 * Create modal locks Type = Release. Columns: Name, Theme, Start Date, Release Date,
 * Project, Planned Velocity, Task Estimate, State.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { AlertTriangle, Plus, PackageOpen, Trash2 } from 'lucide-react'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { BRAND } from '@/shared/config/brand'
import { InlineSelect } from '@/shared/ui/native-select'
import { TimeboxTypeSwitcher } from '@/pages/timeboxes/timebox-type-switcher'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { useDataTable } from '@/shared/ui/table'
import { ListPageScaffold } from '@/shared/ui/list-page/list-page-scaffold'
import { ListPageHeader } from '@/shared/ui/list-page/list-page-header'
import { type RowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { type ColKey, RELEASES_COLUMNS } from './model/columns'
import { RELEASE_STATES, RELEASE_STATUS_STYLE } from './model/release-states'
import { CreateReleaseModal } from './ui/create-release-modal'
import { ReleaseRow } from './ui/release-row'
import {
  useReleases,
  useDeleteRelease,
  type Release,
  type ReleaseStatus,
} from '@/features/releases/api'

export function ReleasesPage() {
  const { t } = useTranslation(['releases', 'iterations'])
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canManage = can('release:create') || can('release:edit') || can('release:delete')

  // ── Shared table engine (identical to projects/quality): resize / reorder / show-hide ──
  const table = useDataTable<Release, unknown, ColKey>(RELEASES_COLUMNS, {
    storageKey: STORAGE_KEYS.RELEASES_COLUMNS,
    // Leading gutter (inert grip + selection checkbox) — parity with Iteration Status.
    leadingWidth: 36,
  })
  const colStyleFor = useCallback(
    (key: ColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
  )

  const { data: releases = [], isLoading, isError } = useReleases(projectId)
  const deleteRelease = useDeleteRelease()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReleaseStatus | 'all'>('all')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return releases.filter(
      (r) =>
        (statusFilter === 'all' || r.status === statusFilter) &&
        (!q || r.name.toLowerCase().includes(q) || (r.theme ?? '').toLowerCase().includes(q)),
    )
  }, [releases, search, statusFilter])

  const activeFilterCount = statusFilter !== 'all' ? 1 : 0

  const { sortField, sortDir, toggle } = useTableSort<ColKey>()
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

  const stats = useMemo(
    () => ({
      total: releases.length,
      active: releases.filter((r) => r.status === 'active').length,
      accepted: releases.filter((r) => r.status === 'accepted').length,
      planning: releases.filter((r) => r.status === 'planning').length,
    }),
    [releases],
  )

  // Bulk delete — the scaffold owns selection; accepted releases can't be
  // deleted (domain rule mirrored from the row), so they're skipped.
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  async function handleBulkDelete(selection: RowSelection) {
    const ids = sorted
      .filter((r) => selection.selectedIds.has(r.id) && r.status !== 'accepted')
      .map((r) => r.id)
    try {
      await Promise.all(ids.map((id) => deleteRelease.mutateAsync(id)))
      toast.success(t('delete.deleted'))
      selection.clear()
      setConfirmBulkDelete(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('delete.deleteFailed'))
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
      <ListPageScaffold<Release, ColKey>
        header={
          <ListPageHeader
            title={t('iterations:title')}
            accessory={<TimeboxTypeSwitcher current="releases" />}
          />
        }
        metrics={
          <MetricStrip>
            <MetricCard label={t('metrics.total')} value={stats.total} minWidth={100} />
            <MetricCard
              label={t('metrics.active')}
              value={stats.active}
              valueColor={BRAND.primaryLight}
              minWidth={80}
            />
            <MetricCard
              label={t('metrics.accepted')}
              value={stats.accepted}
              valueColor={BRAND.success}
              minWidth={90}
            />
            <MetricCard label={t('metrics.planning')} value={stats.planning} minWidth={90} />
          </MetricStrip>
        }
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search releases…',
          ariaLabel: 'Search releases',
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
          <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
            {t('common:status')}
            <InlineSelect
              value={statusFilter}
              aria-label="Filter by status"
              onChange={(e) => setStatusFilter(e.target.value as ReleaseStatus | 'all')}
              className="w-auto"
            >
              <option value="all">{t('filters.allStatuses')}</option>
              {RELEASE_STATES.map((s) => (
                <option key={s} value={s}>
                  {RELEASE_STATUS_STYLE[s].label}
                </option>
              ))}
            </InlineSelect>
          </label>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
        bulkActions={
          canManage
            ? (selection) => (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(true)}
                    disabled={deleteRelease.isPending}
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
                    pending={deleteRelease.isPending}
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
        sort={{ col: sortField ?? '', dir: sortDir ?? 'asc', onSort: (c) => toggle(c as ColKey) }}
        items={sorted}
        loading={isLoading}
        skeleton={{ rows: 8, cols: 7 }}
        error={
          isError ? (
            <EmptyState
              icon={<AlertTriangle size={28} className="text-destructive" />}
              title={t('loadError')}
            />
          ) : undefined
        }
        empty={
          filtered.length === 0 ? (
            <EmptyState
              icon={<PackageOpen size={32} className="text-border-strong" />}
              title={search ? t('emptySearch') : t('empty')}
              action={
                !search && canManage ? (
                  <Button variant="link" size="xs" onClick={() => setShowCreate(true)}>
                    {t('createFirst')}
                  </Button>
                ) : undefined
              }
            />
          ) : undefined
        }
        renderRow={(release, { gutter }) => (
          <ReleaseRow
            key={release.id}
            release={release}
            canManage={canManage}
            colStyleFor={colStyleFor}
            gutter={gutter}
          />
        )}
      />

      {showCreate && (
        <CreateReleaseModal projectId={projectId} onClose={() => setShowCreate(false)} />
      )}
    </>
  )
}
