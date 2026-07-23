import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderKanban, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { SearchInput } from '@/shared/ui/search-input'
import { EmptyState } from '@/shared/ui/empty-state'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { Button } from '@/shared/ui/button'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { useDataTable, DataTableFrame } from '@/shared/ui/table'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useClickOutside } from '@/shared/lib/hooks/use-click-outside'
import { useProjects, useUpdateProject } from '@/features/projects/api'
import type { Project } from '@/features/projects/api'
import { type ProjectColKey, type ProjectCtx } from './model/columns'
import {
  PROJECT_COLUMNS,
  ArchiveConfirmModal,
  EditProjectModal,
  NewProjectModal,
} from './ui/project-parts'

export function ProjectsPage() {
  const { t } = useTranslation('projects')
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId
  const { user: currentUser } = useAuthStore()

  const { data: projects = [], isLoading } = useProjects(workspaceId)
  const updateProject = useUpdateProject()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'All' | 'active' | 'archived'>('active')
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useClickOutside<HTMLDivElement>(openMenu !== null, () => setOpenMenu(null))
  const [showNewModal, setShowNewModal] = useState(false)

  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )

  // Shared table engine: header + resize / reorder / show-hide + click-to-sort,
  // persisted per-user. Rows stay page-owned (row-click, actions menu).
  const table = useDataTable<Project, ProjectCtx, ProjectColKey>(PROJECT_COLUMNS, {
    storageKey: STORAGE_KEYS.PROJECTS_COLUMNS,
    sort: { col: sortCol, dir: sortDir, onSort: handleSort },
  })

  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [archivingProject, setArchivingProject] = useState<Project | null>(null)

  const filtered = useMemo(
    () =>
      projects.filter(
        (p) =>
          (filter === 'All' || p.status === filter) &&
          (p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.key.toLowerCase().includes(search.toLowerCase())),
      ),
    [projects, filter, search],
  )

  // Client-side sort over the filtered set (the projects list is fully loaded).
  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    const dir = sortDir === 'asc' ? 1 : -1
    const keyOf = (p: Project): string | number => {
      switch (sortCol) {
        case 'key':
          return p.key.toLowerCase()
        case 'name':
          return p.name.toLowerCase()
        case 'status':
          return p.status
        case 'members':
          return p.memberCount
        case 'startDate':
          return p.startDate ?? ''
        case 'updated':
          return p.updatedAt
        default:
          return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const av = keyOf(a)
      const bv = keyOf(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [filtered, sortCol, sortDir])

  // Client-side pagination over the sorted set. Reset to page 1 (during render,
  // not in an effect) whenever the filtered shape changes so the visible range
  // never lands past the last page.
  const resetKey = `${search}|${filter}|${pageSize}`
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    setCurrentPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(currentPage, pageCount)
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function toggleArchive(project: Project) {
    if (project.status === 'active') {
      // Archive requires confirmation (BA SRS UC-PRJ-03)
      setArchivingProject(project)
      setOpenMenu(null)
      return
    }
    // Restore doesn't need confirmation
    try {
      await updateProject.mutateAsync({ id: project.id, input: { status: 'active' } })
      toast.success(t('toast.restored', { name: project.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.unexpected'))
    }
    setOpenMenu(null)
  }

  async function confirmArchive() {
    if (!archivingProject) return
    try {
      await updateProject.mutateAsync({ id: archivingProject.id, input: { status: 'archived' } })
      toast.success(t('toast.archived', { name: archivingProject.name }))
      setArchivingProject(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.unexpected'))
    }
  }

  const activeCount = projects.filter((p) => p.status === 'active').length

  const stats = {
    total: projects.length,
    active: activeCount,
    archived: projects.filter((p) => p.status === 'archived').length,
    linkedTeams: projects.reduce((sum, p) => sum + (p.teamCount ?? 0), 0),
  }

  const cellCtx: ProjectCtx = {
    currentUserId: currentUser?.id,
    currentUserName: currentUser?.displayName,
    openMenu,
    setOpenMenu,
    onEdit: setEditingProject,
    onToggleArchive: (p) => void toggleArchive(p),
  }
  return (
    <div className="flex flex-1 flex-col bg-background">
      {showNewModal && workspaceId && (
        <NewProjectModal workspaceId={workspaceId} onClose={() => setShowNewModal(false)} />
      )}
      {editingProject && workspaceId && (
        <EditProjectModal
          project={editingProject}
          workspaceId={workspaceId}
          onClose={() => setEditingProject(null)}
        />
      )}
      {archivingProject && (
        <ArchiveConfirmModal
          project={archivingProject}
          onConfirm={() => void confirmArchive()}
          onClose={() => setArchivingProject(null)}
          isPending={updateProject.isPending}
        />
      )}

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-card px-6 py-3">
        <div>
          <h1 className="text-ui-xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-ui-sm text-foreground-subtle">
            {workspace?.workspaceName ?? t('subtitle.workspace')} · {activeCount}{' '}
            {activeCount === 1 ? t('subtitle.oneActive') : t('subtitle.manyActive')}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewModal(true)}>
          <Plus size={13} />
          {t('create.title')}
        </Button>
      </div>

      {/* Summary metric strip */}
      <MetricStrip>
        <MetricCard label={t('metrics.total')} value={stats.total} minWidth={80} />
        <MetricCard
          label={t('metrics.active')}
          value={stats.active}
          valueColor={BRAND.primaryLight}
          minWidth={80}
        />
        <MetricCard label={t('metrics.archived')} value={stats.archived} minWidth={90} />
        <MetricCard label={t('metrics.linkedTeams')} value={stats.linkedTeams} minWidth={110} />
      </MetricStrip>

      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-card px-6 py-2">
        {/* Search */}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search projects…"
          ariaLabel="Search projects"
          iconSize={13}
          className="w-52 py-1.5 pl-8"
        />

        {/* Status filter tabs */}
        <div className="flex items-center gap-1">
          {(['All', 'active', 'archived'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className="rounded px-2.5 py-1 text-ui-sm font-medium capitalize transition-colors"
              style={{
                backgroundColor: filter === tab ? BRAND.primaryLighter : 'transparent',
                color: filter === tab ? BRAND.primary : BRAND.textSecondary,
              }}
            >
              {tab === 'All'
                ? t('status.all')
                : tab === 'active'
                  ? t('status.active')
                  : t('status.archived')}
            </button>
          ))}
        </div>

        {/* Column show/hide + reorder (shared engine) */}
        <div className="ml-auto">
          <ColumnFieldsMenu {...table.fieldsMenuProps} />
        </div>
      </div>

      {/* Table — shared DataTableFrame owns the scroll region, header, loading/
          empty states and footer, so projects' grid chrome matches every other
          grid (see FRONTEND_COMPONENT_AUDIT §5.2). */}
      <DataTableFrame
        header={table.headerProps}
        padClassName="gap-2 px-3"
        loading={isLoading}
        empty={
          filtered.length === 0 ? (
            <EmptyState
              icon={
                <FolderKanban
                  size={32}
                  strokeWidth={1.25}
                  className="text-foreground-subtle opacity-40"
                />
              }
              title={t('emptyFiltered')}
              description={t('emptyFilteredDesc')}
            />
          ) : undefined
        }
        footer={
          filtered.length > 0 ? (
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={setPageSize}
              currentPage={safePage}
              rangeStart={(safePage - 1) * pageSize + 1}
              rangeEnd={(safePage - 1) * pageSize + paged.length}
              total={filtered.length}
              pageCount={pageCount}
              hasPrevPage={safePage > 1}
              hasNextPage={safePage < pageCount}
              onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
            />
          ) : undefined
        }
      >
        <div ref={menuRef}>
          {paged.map((project) => (
            <div
              key={project.id}
              onClick={() => setEditingProject(project)}
              className="flex min-h-12 cursor-pointer items-center gap-2 border-b border-border-inner px-3 transition-colors hover:bg-surface-hover"
              style={{
                opacity: project.status === 'archived' ? 0.7 : 1,
                minWidth: 'max-content',
              }}
            >
              {table.renderCells(project, cellCtx)}
            </div>
          ))}
        </div>
      </DataTableFrame>
    </div>
  )
}
