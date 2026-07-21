/**
 * Work Item Detail Page — P1-WI-DETAIL / P1-TASK
 *
 * Route: /item/$itemKey
 * Story/Defect: 3 tabs — Details | Tasks | Revision History
 * Task:         2 tabs — Details | Revision History
 * Sidebar differs by type (task shows time fields + Work Product link).
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import {
  Bell,
  BellOff,
  Bug,
  ChevronLeft,
  History,
  ListChecks,
  MoreHorizontal,
  PanelRightOpen,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useTasks,
  useUpdateWorkItem,
  useWatchers,
  useToggleWatch,
  useDeleteWorkItem,
  useChildDefects,
  type WorkItem,
} from '@/features/work-items/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjectPermissions } from '@/features/access/api'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { TasksTab } from './ui/tasks-tab'
import { HistoryTab, DefectsTab } from './ui/detail-tabs'
import { DetailSidebar } from './ui/detail-sidebar'
import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { AttachmentBlock } from '@/features/collaboration/ui/attachment-block'
import { LinkedItemsBlock } from '@/features/work-items/ui/linked-items-block'
import { CommentThread } from '@/features/collaboration/ui/comment-thread'
import { Spinner } from '@/shared/ui/spinner'
import { useSaveState } from '@/shared/lib/hooks/use-save-state'

// ── Types ─────────────────────────────────────────────────────────────────────

type DetailTab = 'details' | 'tasks' | 'defects' | 'history'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Local Field removed — use shared <FormField> from @/shared/ui/form-field instead.
// Sidebar selects use shared <NativeSelect> from @/shared/ui/native-select.

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({
  item,
  onUpdate,
  readOnly,
}: {
  item: WorkItem
  onUpdate: (patch: Partial<WorkItem>) => void
  readOnly: boolean
}) {
  const isTask = item.type === 'task'

  const handleSave = useCallback(
    (field: 'description' | 'notes' | 'releaseNotes') => (html: string) => {
      onUpdate({ [field]: html || null })
    },
    [onUpdate],
  )

  return (
    <div className="w-full space-y-5">
      <h2 className="text-[20px] font-semibold" style={{ color: BRAND.textPrimary }}>
        Details
      </h2>

      <RichTextEditor
        title="Description"
        value={item.description}
        minHeight={120}
        readOnly={readOnly}
        onSave={handleSave('description')}
      />

      <AttachmentBlock workItemId={item.id} readOnly={readOnly} />

      <LinkedItemsBlock workItemId={item.id} projectId={item.projectId} readOnly={readOnly} />

      <RichTextEditor
        title="Notes"
        value={item.notes}
        minHeight={80}
        readOnly={readOnly}
        onSave={handleSave('notes')}
      />

      {/* Release Notes — Story/Defect only */}
      {!isTask && (
        <RichTextEditor
          title="Release Notes"
          value={item.releaseNotes}
          minHeight={80}
          readOnly={readOnly}
          onSave={handleSave('releaseNotes')}
        />
      )}

      <CommentThread workItemId={item.id} projectId={item.projectId} readOnly={readOnly} />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkItemDetailPage() {
  const { itemKey } = useParams({ from: '/auth/item/$itemKey' })
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<DetailTab>('details')
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  // P1-10: sidebar collapse — persisted in localStorage so preference survives navigation
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.WI_SIDEBAR_COLLAPSED) === '1'
    } catch {
      return false
    }
  })
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEYS.WI_SIDEBAR_COLLAPSED, next ? '1' : '0')
      } catch {
        /* noop */
      }
      return next
    })
  }, [])

  const { data: itemByKey, isLoading: loadingKey } = useWorkItemByKey(itemKey)

  const updateMutation = useUpdateWorkItem(itemByKey?.id ?? '')
  const deleteMutation = useDeleteWorkItem()
  const { status: saveStatus, errorMsg: saveErrorMsg, wrap: wrapSave } = useSaveState()

  // P1-11: work item is read-only when the user lacks work_item:edit permission.
  // BA spec: all active roles (non-Viewer) can update any work item.
  const { can } = useProjectPermissions(itemByKey?.projectId)
  const readOnly = !can('work_item:edit')
  const currentUserId = useAuthStore((s) => s.user?.id)

  // P1-23: watchers
  const { data: watchers = [] } = useWatchers(itemByKey?.id)
  const toggleWatch = useToggleWatch(itemByKey?.id)
  const isWatching = watchers.some((w) => w.userId === currentUserId)

  // Defects tab: fetch child defects for stories
  const isStory = itemByKey?.type === 'story'
  const { data: childDefects = [] } = useChildDefects(
    isStory ? itemByKey.id : undefined,
    isStory ? itemByKey.projectId : undefined,
  )
  const defectCount = childDefects.length

  // Tasks tab count (DEV-012): drive from the SAME collection the Tasks table
  // and roll-up read, so the badge always matches the persisted child tasks and
  // refreshes after a create/delete (both invalidate the ['work-items'] root).
  const showsTasks = itemByKey != null && itemByKey.type !== 'task'
  const { data: tasksForCount = [] } = useTasks(showsTasks ? itemByKey.id : undefined)
  const taskCount = tasksForCount.length

  const patchItem = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!itemByKey) return
      await wrapSave(async () => {
        await updateMutation.mutateAsync(patch)
      })
    },
    [itemByKey, updateMutation, wrapSave],
  )

  useEffect(() => {
    if (!moreOpen) return
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [moreOpen])

  async function handleDelete() {
    if (!itemByKey) return
    try {
      await deleteMutation.mutateAsync({ id: itemByKey.id, projectId: itemByKey.projectId })
      toast.success(`${itemByKey.itemKey} deleted`)
      setConfirmDelete(false)
      void navigate({ to: '/backlog' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete work item')
    }
  }

  if (loadingKey) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!itemByKey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm font-medium" style={{ color: BRAND.textSecondary }}>
          Work item "{itemKey}" not found.
        </p>
        <button
          onClick={() => void navigate({ to: '/backlog' })}
          className="text-xs font-medium"
          style={{ color: BRAND.primaryLight }}
        >
          ← Back to Backlog
        </button>
      </div>
    )
  }

  const item = itemByKey
  const isTask = item.type === 'task'

  type TabDef = { id: DetailTab; icon: React.ReactNode; label: string }
  const tabs: TabDef[] = [
    {
      id: 'details',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
      label: 'Details',
    },
    ...(!isTask
      ? [
          {
            id: 'tasks' as DetailTab,
            icon: (
              <span className="flex items-center gap-1.5">
                <ListChecks size={19} />
                <span className="text-[10px] font-semibold tabular-nums">{taskCount}</span>
              </span>
            ),
            label: 'Tasks',
          },
        ]
      : []),
    ...(isStory
      ? [
          {
            id: 'defects' as DetailTab,
            icon: (
              <span className="flex items-center gap-1.5">
                <Bug size={19} />
                <span className="text-[10px] font-semibold tabular-nums">{defectCount}</span>
              </span>
            ),
            label: 'Defects',
          },
        ]
      : []),
    {
      id: 'history',
      icon: <History size={19} />,
      label: 'Revision History',
    },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      {/* Header bar */}
      <div className="shrink-0 text-white" style={{ backgroundColor: BRAND.primaryDark }}>
        {/* Title row */}
        <div
          className="flex h-12 items-center gap-3 px-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,.18)' }}
        >
          <button
            aria-label="Back"
            onClick={() => void navigate({ to: '/backlog' })}
            className="rounded p-1.5 hover:bg-white/10"
          >
            <ChevronLeft size={18} />
          </button>
          <TypeBadge type={item.type} />
          <span className="font-mono text-[13px] font-semibold text-white">{item.itemKey}</span>
          <span className="h-5 w-px bg-white/25" />
          <h1 className="truncate text-[15px] font-semibold">{item.title}</h1>
          <div className="flex-1" />

          {/* Watcher count badge */}
          {watchers.length > 0 && (
            <div
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium"
              style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: BRAND.accentBg }}
              title={`${watchers.length} watcher${watchers.length !== 1 ? 's' : ''}`}
            >
              <Users size={12} />
              <span>{watchers.length}</span>
            </div>
          )}

          {/* Watch / Unwatch button */}
          <button
            aria-label={isWatching ? 'Unwatch this item' : 'Watch this item'}
            title={
              isWatching
                ? 'Unwatch — stop receiving notifications'
                : 'Watch — get notified on changes'
            }
            onClick={() => void toggleWatch.mutate(isWatching)}
            disabled={toggleWatch.isPending}
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: isWatching ? 'rgba(255,255,255,0.18)' : 'transparent',
              color: isWatching ? 'white' : BRAND.accentBg,
              border: '1px solid',
              borderColor: isWatching ? 'rgba(255,255,255,0.3)' : 'transparent',
            }}
          >
            {isWatching ? <BellOff size={14} /> : <Bell size={14} />}
            <span>{isWatching ? 'Watching' : 'Watch'}</span>
          </button>

          {/* BA rule (P3.4): defects are never deleted — hide the whole menu for them. */}
          {!readOnly && itemByKey.type !== 'defect' && (
            <div ref={moreRef} className="relative">
              <button
                aria-label="More actions"
                onClick={() => setMoreOpen((o) => !o)}
                className="rounded p-1.5 hover:bg-white/10"
              >
                <MoreHorizontal size={17} />
              </button>
              {moreOpen && (
                <div
                  className="absolute top-full right-0 z-50 mt-1 w-44 overflow-hidden rounded shadow-lg"
                  style={{ backgroundColor: 'white', border: `1px solid ${BRAND.borderInput}` }}
                >
                  <button
                    onClick={() => {
                      setMoreOpen(false)
                      setConfirmDelete(true)
                    }}
                    disabled={deleteMutation.isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-red-50 disabled:opacity-50"
                    style={{ color: BRAND.danger }}
                  >
                    <Trash2 size={13} />
                    Delete work item
                  </button>
                </div>
              )}
              <ConfirmDialog
                open={confirmDelete}
                title="Delete work item"
                message={
                  itemByKey ? `Delete ${itemByKey.itemKey}? This cannot be undone.` : undefined
                }
                confirmLabel="Delete"
                destructive
                pending={deleteMutation.isPending}
                onConfirm={() => void handleDelete()}
                onCancel={() => setConfirmDelete(false)}
              />
            </div>
          )}
        </div>

        {/* Tab row */}
        <div className="flex h-16 items-stretch gap-2 px-5">
          {tabs.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex flex-col items-center justify-center gap-1 px-4 text-[11px] font-medium"
              style={{
                backgroundColor: activeTab === id ? BRAND.primaryLight : 'transparent',
                color: activeTab === id ? 'white' : BRAND.accentBg,
              }}
            >
              <span className="flex h-5 items-center justify-center">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1" style={{ backgroundColor: BRAND.avatarBg }}>
        {/* Main content */}
        <main
          className="flex-1 overflow-y-auto p-6"
          style={{ backgroundColor: BRAND.surfaceSubtle }}
        >
          {activeTab === 'details' && (
            <DetailsTab
              item={item}
              onUpdate={(patch) => void patchItem(patch as Record<string, unknown>)}
              readOnly={readOnly}
            />
          )}
          {activeTab === 'tasks' && !isTask && (
            <TasksTab workItemId={item.id} projectId={item.projectId} readOnly={readOnly} />
          )}
          {activeTab === 'defects' && isStory && (
            <DefectsTab workItemId={item.id} projectId={item.projectId} />
          )}
          {activeTab === 'history' && <HistoryTab workItemId={item.id} />}
        </main>

        {/* Sidebar — only on details tab */}
        {activeTab === 'details' && (
          <DetailSidebar
            item={item}
            onUpdate={(patch) => void patchItem(patch as Record<string, unknown>)}
            updating={updateMutation.isPending}
            readOnly={readOnly}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            saveStatus={saveStatus}
            saveErrorMsg={saveErrorMsg}
          />
        )}
        {/* Collapsed sidebar tab — re-open handle when sidebar is hidden */}
        {activeTab === 'details' && sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            title="Show sidebar"
            className="flex w-6 shrink-0 items-center justify-center transition-colors hover:bg-border-subtle"
            style={{
              borderLeft: `1px solid ${BRAND.borderInput}`,
              backgroundColor: BRAND.surfaceSubtle,
            }}
          >
            <PanelRightOpen size={14} style={{ color: BRAND.textSecondary }} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── useWorkItemByKey hook ─────────────────────────────────────────────────────
// Resolves a route item key to a work item via GET /v1/work-items/by-key, which
// falls back to the tasks table server-side so task detail pages are reachable.

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { workItemKeys } from '@/features/work-items/api'

function useWorkItemByKey(itemKey: string) {
  const { project } = useAppContext()
  const projectId = project?.projectId
  return useQuery({
    queryKey: workItemKeys.byKey(itemKey, projectId),
    queryFn: async (): Promise<WorkItem | null> => {
      if (!projectId) return null
      const { data, error, response } = await apiClient.GET('/v1/work-items/by-key', {
        params: { query: { projectId, itemKey } },
      })
      if (error) {
        if (response.status === 404) return null
        throw new Error(apiErrorMessage(error, response.status))
      }
      return (data as WorkItem | undefined) ?? null
    },
    enabled: !!itemKey && !!projectId,
    staleTime: 15_000,
  })
}
