/**
 * Releases — P3.2 Release Management
 *
 * Dense dashboard with inline-editable rows. Status values: Planning, Active, Accepted.
 * Create modal locks Type = Release. Columns: Name, Theme, Start Date, Release Date,
 * Project, Planned Velocity, Task Estimate, State.
 */
import { useCallback, useMemo, useState } from 'react'
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
import { CreateReleaseModal, ReleaseDetailModal, ReleaseRow } from './ui/release-parts'
import { useReleases, useDeleteRelease, type Release } from '@/features/releases/api'

export function ReleasesPage() {
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
      toast.success('Release deleted')
      setDeleteId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete release')
    }
  }

  if (!projectId) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ backgroundColor: BRAND.pageBg }}
      >
        <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
          Select a project to view releases.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: BRAND.pageBg }}>
      {/* Header */}
      <PageToolbar
        title="Releases"
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
              <Plus size={13} /> Create Release
            </Button>
          ) : undefined
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* Summary metric strip */}
      <MetricStrip>
        <MetricCard label="Total Releases" value={stats.total} minWidth={100} />
        <MetricCard
          label="Active"
          value={stats.active}
          valueColor={BRAND.primaryLight}
          minWidth={80}
        />
        <MetricCard
          label="Accepted"
          value={stats.accepted}
          valueColor={BRAND.success}
          minWidth={90}
        />
        <MetricCard label="Planning" value={stats.planning} minWidth={90} />
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
              title="Failed to load releases. Please try again."
            />
          ) : undefined
        }
        empty={
          filtered.length === 0 ? (
            <EmptyState
              icon={<PackageOpen size={32} className="text-border-strong" />}
              title={search ? 'No releases match your search.' : 'No releases yet.'}
              action={
                !search && canManage ? (
                  <Button variant="link" size="xs" onClick={() => setShowCreate(true)}>
                    + Create first release
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
        title="Delete release"
        message="Delete this release? Work items will keep their release assignment."
        confirmLabel="Delete release"
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
