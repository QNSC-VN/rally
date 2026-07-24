/**
 * Work Item Detail Page — P1-WI-DETAIL / P1-TASK
 *
 * Route: /item/$itemKey
 * Story/Defect: 3 tabs — Details | Tasks | Revision History
 * Task:         2 tabs — Details | Revision History
 * Sidebar differs by type (task shows time fields + Work Product link).
 */
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from '@tanstack/react-router'
import {
  Bell,
  BellOff,
  Bug,
  FileText,
  GitPullRequest,
  History,
  ListChecks,
  PanelRightOpen,
  Users,
} from 'lucide-react'
import {
  useTasks,
  useUpdateWorkItem,
  useWatchers,
  useToggleWatch,
  useChildDefects,
  useWorkItemConnections,
  useWorkItemChangesets,
  type WorkItem,
  type UpdateWorkItemInput,
} from '@/features/work-items/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjectPermissions } from '@/features/access/api'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { DetailLayout } from '@/shared/ui/detail/detail-layout'
import { DetailHeaderButton } from '@/shared/ui/detail-header'
import { TasksTab } from './ui/tasks-tab'
import { HistoryTab, DefectsTab } from './ui/detail-tabs'
import { ConnectionsTab } from './ui/connections-tab'
import { DetailSidebar } from './ui/detail-sidebar'
import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { AttachmentBlock } from '@/features/collaboration/ui/attachment-block'
import { LinkedItemsBlock } from '@/features/work-items/ui/linked-items-block'
import { CommentThread } from '@/features/collaboration/ui/comment-thread'
import { Spinner } from '@/shared/ui/spinner'
import { useSaveState } from '@/shared/lib/hooks/use-save-state'
import { usePendingPatch } from '@/shared/lib/hooks/use-pending-patch'
import { SaveCancelBar } from '@/shared/ui/save-cancel-bar'
import { useUploadPastedImages } from '@/features/collaboration/use-upload-pasted-images'

// ── Types ─────────────────────────────────────────────────────────────────────

type DetailTab = 'details' | 'tasks' | 'defects' | 'connections' | 'history'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Local Field removed — use shared <FormField> from @/shared/ui/form-field instead.
// Sidebar selects use shared <NativeSelect> from @/shared/ui/native-select.

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({
  item,
  onFieldChange,
  readOnly,
}: {
  item: WorkItem
  onFieldChange: (patch: Partial<UpdateWorkItemInput>) => void
  readOnly: boolean
}) {
  const { t } = useTranslation('work-items')
  const isTask = item.type === 'task'

  const handleChange = useCallback(
    (field: 'description' | 'notes' | 'releaseNotes') => (html: string) => {
      onFieldChange({ [field]: html || null })
    },
    [onFieldChange],
  )

  return (
    <div className="w-full space-y-5">
      <h2 className="text-xl font-semibold text-foreground">{t('details.heading')}</h2>

      <RichTextEditor
        title={t('common:description')}
        value={item.description}
        minHeight={120}
        readOnly={readOnly}
        onChange={handleChange('description')}
      />

      <AttachmentBlock workItemId={item.id} readOnly={readOnly} />

      <LinkedItemsBlock workItemId={item.id} projectId={item.projectId} readOnly={readOnly} />

      <RichTextEditor
        title={t('details.notes')}
        value={item.notes}
        minHeight={80}
        readOnly={readOnly}
        onChange={handleChange('notes')}
      />

      {/* Release Notes — Story/Defect only */}
      {!isTask && (
        <RichTextEditor
          title={t('details.releaseNotes')}
          value={item.releaseNotes}
          minHeight={80}
          readOnly={readOnly}
          onChange={handleChange('releaseNotes')}
        />
      )}

      <CommentThread workItemId={item.id} projectId={item.projectId} readOnly={readOnly} />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkItemDetailPage() {
  const { t } = useTranslation('work-items')
  const { itemKey } = useParams({ from: '/auth/item/$itemKey' })
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<DetailTab>('details')

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
  const { status: saveStatus, errorMsg: saveErrorMsg, wrap: wrapSave } = useSaveState()
  const { uploadAndRewrite } = useUploadPastedImages(itemByKey?.id)

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

  // Connections tab badge = linked pull requests + changesets (matches Rally,
  // e.g. 11 connections + 12 changesets → "23"). Both queries live under the
  // ['work-items'] root, so they refresh with the rest of the work-item views.
  const { data: scmConnections } = useWorkItemConnections(itemByKey?.id)
  const { data: scmChangesets } = useWorkItemChangesets(itemByKey?.id)
  const connectionsCount = (scmConnections?.total ?? 0) + (scmChangesets?.total ?? 0)

  // Broadcom-Rally-style Save/Cancel: field edits accumulate locally (sidebar
  // dropdowns AND rich-text editors alike) instead of auto-saving on every
  // change; the floating bar below commits or discards them all at once.
  // Falls back to an empty object while the entity is still loading — the
  // hook must run unconditionally on every render (Rules of Hooks), the
  // loadingKey/!itemByKey guards below happen after.
  const {
    value: item,
    isDirty,
    saving,
    setField,
    save,
    cancel,
  } = usePendingPatch<WorkItem, UpdateWorkItemInput>(
    itemByKey ?? ({} as WorkItem),
    itemByKey?.id,
    async (patch) => {
      // Upload any pasted-image previews still sitting as blob: URLs before
      // persisting — this is the actual "upload happens on Save" step.
      const resolved = { ...patch }
      if (typeof resolved.description === 'string') {
        resolved.description = await uploadAndRewrite(resolved.description)
      }
      if (typeof resolved.notes === 'string') {
        resolved.notes = await uploadAndRewrite(resolved.notes)
      }
      if (typeof resolved.releaseNotes === 'string') {
        resolved.releaseNotes = await uploadAndRewrite(resolved.releaseNotes)
      }
      await wrapSave(async () => {
        await updateMutation.mutateAsync(resolved)
      })
    },
  )

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
        <p className="text-sm font-medium text-muted-foreground">
          {t('notFound', { key: itemKey })}
        </p>
        <button
          onClick={() => void navigate({ to: '/backlog' })}
          className="text-xs font-medium text-primary-light"
        >
          {t('backToBacklog')}
        </button>
      </div>
    )
  }

  const isTask = item.type === 'task'

  type TabDef = { id: DetailTab; icon: React.ReactNode; label: string }
  const tabs: TabDef[] = [
    {
      id: 'details',
      icon: <FileText size={19} />,
      label: t('tabs.details'),
    },
    ...(!isTask
      ? [
          {
            id: 'tasks' as DetailTab,
            icon: (
              <span className="flex items-center gap-1.5">
                <ListChecks size={19} />
                <span className="text-ui-xs font-semibold tabular-nums">{taskCount}</span>
              </span>
            ),
            label: t('tabs.tasks'),
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
                <span className="text-ui-xs font-semibold tabular-nums">{defectCount}</span>
              </span>
            ),
            label: t('tabs.defects'),
          },
        ]
      : []),
    {
      id: 'connections',
      icon: (
        <span className="flex items-center gap-1.5">
          <GitPullRequest size={19} />
          <span className="text-ui-xs font-semibold tabular-nums">{connectionsCount}</span>
        </span>
      ),
      label: t('tabs.connections'),
    },
    {
      id: 'history',
      icon: <History size={19} />,
      label: t('tabs.history'),
    },
  ]

  // The route component persists across itemKey changes, so a Story's "Tasks"
  // tab could remain selected on a Task that has no such tab. Derive the tab to
  // render (fall back to Details) instead of resetting state — no effect/ref.
  const activeTabId: DetailTab = tabs.some((tb) => tb.id === activeTab) ? activeTab : 'details'

  return (
    <DetailLayout
      onBack={() => void navigate({ to: '/backlog' })}
      badge={<TypeBadge type={item.type} />}
      itemKey={item.itemKey}
      title={
        readOnly ? (
          item.title
        ) : (
          <input
            value={item.title ?? ''}
            onChange={(e) => setField({ title: e.target.value })}
            className="w-full rounded border-0 bg-transparent px-1 py-0.5 text-base font-semibold text-white placeholder-white/60 focus:bg-white/10 focus:outline-none"
            aria-label="Title"
          />
        )
      }
      tabs={tabs.map((tb) => ({ key: tb.id, label: tb.label, icon: tb.icon }))}
      activeTab={activeTabId}
      onTabChange={(k) => setActiveTab(k as DetailTab)}
      actions={
        <>
          {/* Watcher count badge — always shown (Rally parity), even at 0. */}
          <div
            className="flex items-center gap-1 rounded px-2 py-1 text-ui-sm font-medium"
            style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: BRAND.accentBg }}
            title={`${watchers.length} watcher${watchers.length !== 1 ? 's' : ''}`}
          >
            <Users size={12} />
            <span>{watchers.length}</span>
          </div>

          {/* Watch / Unwatch — shared dark-bar toggle (primary tone when watching) */}
          <DetailHeaderButton
            tone={isWatching ? 'primary' : 'ghost'}
            ariaLabel={isWatching ? 'Unwatch this item' : 'Watch this item'}
            title={
              isWatching
                ? 'Unwatch — stop receiving notifications'
                : 'Watch — get notified on changes'
            }
            onClick={() => void toggleWatch.mutate(isWatching)}
            disabled={toggleWatch.isPending}
          >
            {isWatching ? <BellOff size={14} /> : <Bell size={14} />}
            <span>{isWatching ? t('watch.watching') : t('watch.watch')}</span>
          </DetailHeaderButton>
        </>
      }
    >
      {/* Content area */}
      <div className="flex min-h-0 flex-1 bg-avatar">
        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-surface-subtle p-6">
          {activeTabId === 'details' && (
            <DetailsTab item={item} onFieldChange={setField} readOnly={readOnly} />
          )}
          {activeTabId === 'tasks' && !isTask && (
            <TasksTab workItemId={item.id} projectId={item.projectId} readOnly={readOnly} />
          )}
          {activeTabId === 'defects' && isStory && (
            <DefectsTab workItemId={item.id} projectId={item.projectId} />
          )}
          {activeTabId === 'connections' && <ConnectionsTab workItemId={item.id} />}
          {activeTabId === 'history' && <HistoryTab workItemId={item.id} />}
        </main>

        {/* Sidebar — only on details tab */}
        {activeTabId === 'details' && (
          <DetailSidebar
            item={item}
            onUpdate={setField}
            updating={saving}
            readOnly={readOnly}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            saveStatus={saveStatus}
            saveErrorMsg={saveErrorMsg}
          />
        )}
        {/* Collapsed sidebar tab — re-open handle when sidebar is hidden */}
        {activeTabId === 'details' && sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            title="Show sidebar"
            className="flex w-6 shrink-0 items-center justify-center border-l border-input bg-surface-subtle transition-colors hover:bg-border-subtle"
          >
            <PanelRightOpen size={14} className="text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Floating Save/Cancel — appears once any field has an unsaved edit
          (sidebar dropdowns or the rich-text editors), matching Broadcom
          Rally's UX instead of auto-saving each field on change. */}
      <SaveCancelBar
        visible={isDirty && !readOnly}
        saving={saving}
        errorMsg={saveStatus === 'error' ? saveErrorMsg : null}
        onSave={() => void save()}
        onCancel={cancel}
      />
    </DetailLayout>
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
