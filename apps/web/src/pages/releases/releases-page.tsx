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
import { AlertTriangle, Plus, PackageOpen } from 'lucide-react'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { BRAND } from '@/shared/config/brand'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { DataTableFrame, useDataTable } from '@/shared/ui/table'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { type ColKey, RELEASES_COLUMNS } from './model/columns'
import { CreateReleaseModal } from './ui/create-release-modal'
import { ReleaseDetailModal } from './ui/release-detail-modal'
import { ReleaseRow } from './ui/release-row'
import { useReleases, useDeleteRelease, type Release } from '@/features/releases/api'

export function ReleasesPage() {
  const { t } = useTranslation('releases')
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canManage = can('release:create') || can('release:edit') || can('release:delete')

  // ── Shared table engine (identical to projects/quality): resize / reorder / show-hide ──
  const table = useDataTable<Release, unknown, ColKey>(RELEASES_COLUMNS, {
    storageKey: STORAGE_KEYS.RELEASES_COLUMNS,
  })
  const colStyleFor = useCallback(
    (key: ColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
  )

  const { data: releases = [], isLoading, isError } = useReleases(projectId)
  const deleteRelease = useDeleteRelease(projectId ?? '')

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingRelease, setEditingRelease] = useState<Release | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return releases
    const q = search.toLowerCase()
    return releases.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.theme ?? '').toLowerCase().includes(q),
    )
  }, [releases, search])

  const stats = useMemo(
    () => ({
      total: releases.length,
      active: releases.filter((r) => r.status === 'active').length,
      accepted: releases.filter((r) => r.status === 'accepted').length,
      planning: releases.filter((r) => r.status === 'planning').length,
    }),
    [releases],
  )

  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    try {
      await deleteRelease.mutateAsync(id)
      toast.success(t('delete.deleted'))
      setDeleteId(null)
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
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <PageToolbar
        title={t('title')}
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
              <Plus size={13} /> {t('createButton')}
            </Button>
          ) : undefined
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* Summary metric strip */}
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

      {/* Table — shared DataTableFrame owns the chrome (read-only list kind:
          sortable header, no totals / selection / drag gutter). */}
      <DataTableFrame
        header={table.headerProps}
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
      >
        {filtered.map((release) => (
          <ReleaseRow
            key={release.id}
            release={release}
            projectId={projectId!}
            canManage={canManage}
            onDelete={(id) => setDeleteId(id)}
            colStyleFor={colStyleFor}
          />
        ))}
      </DataTableFrame>

      <ConfirmDialog
        open={deleteId !== null}
        title={t('delete.title')}
        message={t('delete.message')}
        confirmLabel={t('delete.confirm')}
        destructive
        pending={deleteRelease.isPending}
        onConfirm={() => deleteId && void handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />

      {/* Modals */}
      {showCreate && (
        <CreateReleaseModal projectId={projectId} onClose={() => setShowCreate(false)} />
      )}
      {editingRelease && (
        <ReleaseDetailModal
          release={editingRelease}
          projectId={projectId!}
          onClose={() => setEditingRelease(null)}
        />
      )}
    </div>
  )
}
