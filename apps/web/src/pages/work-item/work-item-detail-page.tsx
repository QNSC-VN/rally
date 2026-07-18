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
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useTasks,
  useTaskTotals,
  useActivityLog,
  useWorkItemLabels,
  useUpdateWorkItem,
  useWorkItem,
  useWatchers,
  useToggleWatch,
  useDeleteWorkItem,
  useChildDefects,
  useBacklog,
  type WorkItem,
} from '@/features/work-items/api'
import { useReleases } from '@/features/releases/api'
import { useProjectStatuses } from '@/features/projects/api'
import { useProjectTeams, useProjectMembers } from '@/features/teams/api'
import { useIterationOptions } from '@/features/iterations/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjectPermissions } from '@/features/access/api'
import {
  TypeBadge,
  ScheduleStateBadge,
  PriorityBadge,
  SeverityBadge,
} from '@/entities/work-item/ui/badges'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { LabelChips } from '@/entities/work-item/ui/label-chips'
import { TaskRollup } from '@/entities/work-item/ui/task-rollup'
import { describeActivity } from '@/entities/work-item/model/activity'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { Button } from '@/shared/ui/button'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import {
  PRIORITY_VALUES,
  ScheduleState,
  WORK_ITEM_PRIORITY_CONFIG,
  type WorkItemType,
} from '@/entities/work-item/model/types'
import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { FormField } from '@/shared/ui/form-field'
import { NativeSelect } from '@/shared/ui/native-select'
import { AddTaskModal } from '@/features/work-items/ui/add-task-modal'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { AttachmentBlock } from '@/features/collaboration/ui/attachment-block'
import { LinkedItemsBlock } from '@/features/work-items/ui/linked-items-block'
import { CommentThread } from '@/features/collaboration/ui/comment-thread'
import { Spinner } from '@/shared/ui/spinner'
import { useSaveState } from '@/shared/lib/hooks/use-save-state'
import { SaveIndicator } from '@/shared/ui/save-indicator'

// ── Types ─────────────────────────────────────────────────────────────────────

type SaveStatus = ReturnType<typeof useSaveState>['status']
type DetailTab = 'details' | 'tasks' | 'defects' | 'history'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Local Field removed — use shared <FormField> from @/shared/ui/form-field instead.
// Sidebar selects use shared <NativeSelect> from @/shared/ui/native-select.

// ── Details tab ───────────────────────────────────────────────────────────────

/** Editable parent story dropdown for defects. */
function ParentStorySelect({
  projectId,
  currentParentId,
  onUpdate,
}: {
  projectId: string
  currentParentId: string | null
  onUpdate: (patch: { parentId: string | null }) => void
}) {
  const { data: backlogData } = useBacklog(projectId, { type: 'story' })
  const stories = backlogData?.data ?? []
  return (
    <NativeSelect
      value={currentParentId ?? ''}
      onChange={(e) => onUpdate({ parentId: e.target.value || null })}
    >
      <option value="">No parent story</option>
      {stories.map((s) => (
        <option key={s.id} value={s.id}>
          {s.itemKey} — {s.title}
        </option>
      ))}
    </NativeSelect>
  )
}

/**
 * Read-only related-item field (Work Product / Feature / Parent Story) rendered
 * as a bordered pill via the shared <WorkItemRefCell>. Falls back to a muted
 * placeholder while the target loads or when unset.
 */
function RelatedItemField({
  label,
  target,
  emptyText,
  onOpen,
}: {
  label: string
  target: WorkItem | null | undefined
  emptyText: string
  onOpen: (itemKey: string) => void
}) {
  return (
    <FormField label={label}>
      {target ? (
        <WorkItemRefCell
          variant="pill"
          type={target.type as WorkItemType}
          itemKey={target.itemKey}
          title={target.title}
          onOpen={() => onOpen(target.itemKey)}
        />
      ) : (
        <span
          className="block rounded px-3 py-2 text-[12px]"
          style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textMuted }}
        >
          {emptyText}
        </span>
      )}
    </FormField>
  )
}

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

// ── Tasks tab ─────────────────────────────────────────────────────────────────

// TASK-FR-003: columns Rank, ID, Name, State, Owner, Project, Teams, To Do, Actuals, Estimate.
const TASK_GRID = '44px 56px 108px 1fr 130px 150px 110px 120px 60px 60px 80px'
const TASK_COLS = [
  '',
  'Rank',
  'ID',
  'Name',
  'State',
  'Owner',
  'Project',
  'Teams',
  'To Do',
  'Actuals',
  'Estimate',
]

function TasksTab({ workItemId, projectId }: { workItemId: string; projectId: string }) {
  const { data: tasks = [], isLoading } = useTasks(workItemId)
  const { data: totals } = useTaskTotals(workItemId)
  // Tasks inherit their parent's project; team/owner names are resolved for display.
  const { data: teams = [] } = useProjectTeams(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const { project } = useAppContext()
  const projectLabel = project?.projectKey ?? project?.projectName ?? '—'
  const [showAdd, setShowAdd] = useState(false)
  const navigate = useNavigate()

  const teamName = (id?: string | null) =>
    id ? (teams.find((t) => t.id === id)?.name ?? '—') : '—'
  const ownerName = (id?: string | null) =>
    id ? (members.find((m) => m.userId === id)?.displayName ?? '—') : '—'

  function openTask(task: WorkItem) {
    void navigate({ to: '/item/$itemKey', params: { itemKey: task.itemKey } })
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[20px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Tasks
          </h2>
          <p className="mt-1 text-[11px]" style={{ color: BRAND.textSecondary }}>
            Break this work item into trackable delivery tasks.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} />
          Add Task
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-20 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded bg-white"
          style={{ border: `1px solid ${BRAND.border}` }}
        >
          <div style={{ minWidth: 1216 }}>
            {/* Header row */}
            <div
              className="grid h-10 items-center"
              style={{
                gridTemplateColumns: TASK_GRID,
                backgroundColor: 'white',
                borderBottom: `2px solid ${BRAND.accentBorderStrong}`,
              }}
            >
              {TASK_COLS.map((col, i) => (
                <span
                  key={i}
                  className="flex h-full items-center px-3 text-[12px] font-semibold"
                  style={{
                    color: BRAND.textPrimary,
                    borderRight:
                      i < TASK_COLS.length - 1 ? `1px dashed ${BRAND.textMuted}` : undefined,
                  }}
                >
                  {col}
                </span>
              ))}
            </div>

            {/* Totals row */}
            {totals && (
              <div
                className="grid h-8 items-center text-[12px] font-semibold"
                style={{
                  gridTemplateColumns: TASK_GRID,
                  backgroundColor: BRAND.surfaceSubtle,
                  borderBottom: `1px solid ${BRAND.borderInput}`,
                  color: BRAND.textPrimary,
                }}
              >
                <span />
                <span />
                <span className="px-3">Totals</span>
                <span />
                <span />
                <span />
                <span />
                <span />
                <span className="px-3 text-right font-mono">{totals.todoHours ?? 0}h</span>
                <span className="px-3 text-right font-mono">{totals.actualHours ?? 0}h</span>
                <span className="px-3 text-right font-mono">{totals.estimateHours ?? 0}h</span>
              </div>
            )}

            {/* Empty */}
            {tasks.length === 0 && (
              <div className="flex h-20 items-center justify-center">
                <p className="text-sm" style={{ color: BRAND.textMuted }}>
                  No tasks yet.{' '}
                  <button
                    onClick={() => setShowAdd(true)}
                    className="font-medium"
                    style={{ color: BRAND.primaryLight }}
                  >
                    Add one
                  </button>
                </p>
              </div>
            )}

            {/* Task rows */}
            {tasks.map((task) => (
              <div
                key={task.id}
                className="grid min-h-10 cursor-pointer items-center text-[12px] hover:bg-primary-lighter"
                style={{
                  gridTemplateColumns: TASK_GRID,
                  borderBottom: `1px solid ${BRAND.borderInner}`,
                  color: BRAND.textPrimary,
                }}
                onClick={() => openTask(task)}
              >
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`Select task ${task.itemKey}`}
                    className="h-4 w-4 rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <span className="px-3 font-mono text-[11px]" style={{ color: BRAND.textSecondary }}>
                  {task.rank ?? '—'}
                </span>
                <span className="flex items-center overflow-hidden px-3">
                  <IdCell type={task.type} itemKey={task.itemKey} onOpen={() => openTask(task)} />
                </span>
                <span className="truncate px-3 font-medium">{task.title}</span>
                <span className="px-3">
                  <ScheduleStateBadge state={task.scheduleState} />
                </span>
                <span className="flex items-center overflow-hidden px-3">
                  <OwnerCell name={task.assigneeId ? ownerName(task.assigneeId) : null} />
                </span>
                <span className="truncate px-3" style={{ color: BRAND.textSecondary }}>
                  {projectLabel}
                </span>
                <span className="truncate px-3" style={{ color: BRAND.textSecondary }}>
                  {teamName(task.teamId)}
                </span>
                <span className="px-3 text-right font-mono">
                  {task.todoHours != null ? `${task.todoHours}h` : '—'}
                </span>
                <span className="px-3 text-right font-mono">
                  {task.actualHours != null ? `${task.actualHours}h` : '—'}
                </span>
                <span className="px-3 text-right font-mono">
                  {task.estimateHours != null ? `${task.estimateHours}h` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && <AddTaskModal workItemId={workItemId} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Revision History tab ──────────────────────────────────────────────────────

function HistoryTab({ workItemId }: { workItemId: string }) {
  const { data: logs = [], isLoading } = useActivityLog(workItemId)

  if (isLoading) {
    return (
      <div className="flex h-20 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const GRID = '90px 1fr 190px 170px'

  return (
    <div className="w-full space-y-5">
      <div>
        <h2 className="text-[20px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Revision History
        </h2>
        <p className="mt-1 text-[12px]" style={{ color: BRAND.textSecondary }}>
          Activity log for field changes, task updates, and work item creation.
        </p>
      </div>

      <section
        className="overflow-hidden rounded bg-white"
        style={{ border: `1px solid ${BRAND.border}` }}
      >
        <div
          className="grid px-4 py-2 text-[10px] font-semibold tracking-wider uppercase"
          style={{
            gridTemplateColumns: GRID,
            color: BRAND.textSecondary,
            backgroundColor: BRAND.surfaceHover,
            borderBottom: `1px solid ${BRAND.border}`,
          }}
        >
          <span>Revision</span>
          <span>Description</span>
          <span>Creation Date</span>
          <span>User</span>
        </div>

        {logs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: BRAND.textMuted }}>
            No activity recorded yet.
          </div>
        )}

        {logs.map((log, i) => {
          const revision = logs.length - i
          const userName = log.actorName ?? log.actorId ?? 'System'
          const initials = userName
            .split(' ')
            .slice(0, 2)
            .map((n) => n[0]?.toUpperCase())
            .join('')
          return (
            <div
              key={log.id}
              className="grid items-start px-4 py-3 text-[12px]"
              style={{
                gridTemplateColumns: GRID,
                borderBottom: `1px solid ${BRAND.borderInner}`,
                color: BRAND.textPrimary,
              }}
            >
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{ color: BRAND.primaryLight }}
              >
                {revision}
              </span>
              <span style={{ color: BRAND.textPrimary }}>{describeActivity(log)}</span>
              <span className="font-mono text-[11px]" style={{ color: BRAND.textSecondary }}>
                {new Date(log.createdAt).toLocaleString()}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
                  style={{ backgroundColor: BRAND.avatarBg, color: BRAND.primary }}
                >
                  {initials}
                </span>
                <span className="truncate">{userName}</span>
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}

// ── Defects tab (child defects of a story) ─────────────────────────────────

const DEFECT_COLS = ['ID', 'Title', 'State', 'Priority', 'Owner', 'Severity']
const DEFECT_GRID = '80px 1fr 120px 80px 130px 100px'

function DefectsTab({ workItemId, projectId }: { workItemId: string; projectId: string }) {
  const { data: defects = [], isLoading } = useChildDefects(workItemId, projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const navigate = useNavigate()

  const ownerName = (id?: string | null) =>
    id ? (members.find((m) => m.userId === id)?.displayName ?? '—') : '—'

  function openDefect(d: WorkItem) {
    void navigate({ to: '/item/$itemKey', params: { itemKey: d.itemKey } })
  }

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[20px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Defects
          </h2>
          <p className="mt-0.5 text-[12px]" style={{ color: BRAND.textSecondary }}>
            {defects.length} defect{defects.length !== 1 ? 's' : ''} linked to this story
          </p>
        </div>
      </div>

      {defects.length === 0 ? (
        <div
          className="rounded py-12 text-center"
          style={{ border: `1px dashed ${BRAND.borderInput}` }}
        >
          <Bug size={28} style={{ color: BRAND.textFaint, margin: '0 auto 8px' }} />
          <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
            No defects linked to this story
          </p>
          <p className="mt-1 text-[11px]" style={{ color: BRAND.textMuted }}>
            Create a defect and assign it as a child of this story
          </p>
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded"
          style={{ border: `1px solid ${BRAND.borderInput}` }}
        >
          <div className="min-w-[600px]">
            {/* Header */}
            <div
              className="grid items-center bg-surface-hover px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase"
              style={{
                gridTemplateColumns: DEFECT_GRID,
                color: BRAND.textSecondary,
                borderBottom: `1px solid ${BRAND.borderInput}`,
              }}
            >
              {DEFECT_COLS.map((col) => (
                <span key={col}>{col}</span>
              ))}
            </div>
            {/* Rows */}
            {defects.map((d) => (
              <div
                key={d.id}
                className="grid cursor-pointer items-center px-3 py-2 text-[12px] transition-colors hover:bg-primary-lighter"
                style={{
                  gridTemplateColumns: DEFECT_GRID,
                  borderBottom: `1px solid ${BRAND.borderInner}`,
                }}
                onClick={() => openDefect(d)}
              >
                <span className="flex items-center overflow-hidden">
                  <IdCell type={d.type} itemKey={d.itemKey} onOpen={() => openDefect(d)} />
                </span>
                <span className="truncate font-medium" style={{ color: BRAND.textPrimary }}>
                  {d.title}
                </span>
                <ScheduleStateBadge state={d.scheduleState} />
                <span>
                  <PriorityBadge priority={d.priority} />
                </span>
                <span className="flex items-center overflow-hidden">
                  <OwnerCell name={d.assigneeId ? ownerName(d.assigneeId) : null} />
                </span>
                <span>
                  <SeverityBadge severity={(d as unknown as { severity?: string }).severity} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sidebar (Details tab) ─────────────────────────────────────────────────────

interface SidebarProps {
  item: WorkItem
  onUpdate: (patch: Partial<WorkItem>) => void
  updating: boolean
  readOnly: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  saveStatus?: SaveStatus
  saveErrorMsg?: string | null
}

function DetailSidebar({
  item,
  onUpdate,
  updating,
  readOnly,
  collapsed = false,
  onToggleCollapse,
  saveStatus,
  saveErrorMsg,
}: SidebarProps) {
  const { data: teams = [] } = useProjectTeams(item.projectId)
  const { data: members = [] } = useProjectMembers(item.projectId)
  const { data: releases = [] } = useReleases(item.projectId)
  const { data: iterations = [] } = useIterationOptions(item.projectId, item.teamId)
  const { data: statuses = [] } = useProjectStatuses(item.projectId)
  const { data: parentItem } = useWorkItem(item.parentId ?? undefined)
  const { data: taskTotals } = useTaskTotals(item.type !== 'task' ? item.id : undefined)
  const { data: tags = [] } = useWorkItemLabels(item.id)
  const isTask = item.type === 'task'
  const isDefect = item.type === 'defect'
  const disabled = updating || readOnly
  const navigate = useNavigate()
  const openItem = (itemKey: string) => void navigate({ to: '/item/$itemKey', params: { itemKey } })

  const PRIORITIES = PRIORITY_VALUES.map((v) => ({
    value: v,
    label: WORK_ITEM_PRIORITY_CONFIG[v].label,
  }))

  // When collapsed, render nothing — the page-level "re-open" tab handles visibility
  if (collapsed) return null

  return (
    <aside
      className="w-[300px] shrink-0 overflow-y-auto bg-white"
      style={{ borderLeft: `1px solid ${BRAND.borderInput}` }}
    >
      {/* Collapse toggle header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between bg-white px-3 py-2"
        style={{ borderBottom: `1px solid ${BRAND.avatarBg}` }}
      >
        <span
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textSecondary }}
        >
          Details
        </span>
        <div className="flex items-center gap-2">
          {saveStatus && <SaveIndicator status={saveStatus} errorMsg={saveErrorMsg} />}
          <button
            onClick={onToggleCollapse}
            title="Hide sidebar"
            className="rounded p-1 transition-colors hover:bg-surface-subtle"
          >
            <PanelRightClose size={14} style={{ color: BRAND.textSecondary }} />
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Schedule State */}
        <FormField label="Schedule State">
          <div>
            <StateStepper
              steps={SCHEDULE_STATE_STEPS}
              value={(item.scheduleState ?? ScheduleState.Defined) as ScheduleState}
              canEdit={!disabled}
              onChange={(next) => {
                if (next !== item.scheduleState)
                  onUpdate({ scheduleState: next as WorkItem['scheduleState'] })
              }}
              ariaLabel="Schedule State"
            />
          </div>
        </FormField>

        {/* Flow State (workflow status — project-specific Kanban column) */}
        <FormField label="Flow State">
          <NativeSelect
            value={item.statusId ?? ''}
            onChange={(e) => onUpdate({ statusId: e.target.value })}
            disabled={disabled}
          >
            {statuses.length === 0 && (
              <option value={item.statusId ?? ''}>{item.statusId ?? 'Unknown'}</option>
            )}
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        {/* Owner */}
        <FormField label="Owner">
          <NativeSelect
            value={item.assigneeId ?? ''}
            onChange={(e) => onUpdate({ assigneeId: e.target.value || null })}
            disabled={disabled}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName ?? m.email ?? m.userId}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        {/* Team */}
        <FormField label="Team">
          <NativeSelect
            value={item.teamId ?? ''}
            onChange={(e) => onUpdate({ teamId: e.target.value || null })}
            disabled={disabled}
          >
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        {/* Priority — Defect only */}
        {item.type === 'defect' && (
          <FormField label="Priority">
            <NativeSelect
              value={item.priority ?? 'none'}
              onChange={(e) => onUpdate({ priority: e.target.value as WorkItem['priority'] })}
              disabled={disabled}
            >
              {PRIORITIES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}

        {/* Environment — Defect only */}
        {isDefect && (
          <FormField label="Environment">
            <NativeSelect
              value={item.foundInEnvironment ?? ''}
              onChange={(e) =>
                onUpdate({
                  foundInEnvironment:
                    (e.target.value as 'development' | 'staging' | 'production' | 'testing') ||
                    null,
                })
              }
              disabled={disabled}
            >
              <option value="">Not specified</option>
              <option value="development">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
              <option value="testing">Testing</option>
            </NativeSelect>
          </FormField>
        )}

        {/* Task: Work Product (parent link) */}
        {isTask && item.parentId && (
          <RelatedItemField
            label="Work Product"
            target={parentItem}
            emptyText="Loading…"
            onOpen={openItem}
          />
        )}

        {/* Story: Feature (parent link) */}
        {item.type === 'story' && item.parentId && (
          <RelatedItemField
            label="Feature"
            target={parentItem}
            emptyText="Loading…"
            onOpen={openItem}
          />
        )}

        {/* Defect: Parent Story (editable dropdown, or read-only pill) */}
        {isDefect &&
          (disabled ? (
            <RelatedItemField
              label="Parent Story"
              target={parentItem}
              emptyText={item.parentId ? 'Loading…' : 'No parent story'}
              onOpen={openItem}
            />
          ) : (
            <FormField label="Parent Story">
              <ParentStorySelect
                projectId={item.projectId}
                currentParentId={item.parentId}
                onUpdate={(patch) => onUpdate(patch)}
              />
            </FormField>
          ))}

        {/* Task: time fields */}
        {isTask && (
          <>
            <FormField label="Estimate (h)">
              <input
                type="number"
                min={0}
                step={0.5}
                value={item.estimateHours ?? ''}
                onChange={(e) =>
                  onUpdate({ estimateHours: e.target.value ? Number(e.target.value) : null })
                }
                disabled={disabled}
              />
            </FormField>
            <FormField label="To Do (h)">
              <input
                type="number"
                min={0}
                step={0.5}
                value={item.todoHours ?? ''}
                onChange={(e) =>
                  onUpdate({ todoHours: e.target.value ? Number(e.target.value) : null })
                }
                disabled={disabled}
              />
            </FormField>
            <FormField label="Actual (h)">
              <input
                type="number"
                min={0}
                step={0.5}
                value={item.actualHours ?? ''}
                onChange={(e) =>
                  onUpdate({ actualHours: e.target.value ? Number(e.target.value) : null })
                }
                disabled={disabled}
              />
            </FormField>
          </>
        )}

        {/* Story/Defect: Plan Estimate */}
        {!isTask && (
          <FormField label="Plan Estimate (pts)">
            <input
              type="number"
              min={0}
              value={item.storyPoints ?? ''}
              onChange={(e) =>
                onUpdate({ storyPoints: e.target.value ? Number(e.target.value) : null })
              }
              disabled={disabled}
            />
          </FormField>
        )}

        {/* Story/Defect: Task Roll-up (read-only aggregate of child task hours) */}
        {!isTask && taskTotals && taskTotals.taskCount > 0 && (
          <FormField label="Task Roll-up">
            <TaskRollup
              estimate={taskTotals.estimateHours}
              todo={taskTotals.todoHours}
              actual={taskTotals.actualHours}
            />
          </FormField>
        )}

        {/* Story/Defect: Iteration + Release */}
        {!isTask && (
          <>
            <FormField label="Iteration">
              <NativeSelect
                value={item.iterationId ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null
                  if (v !== (item.iterationId ?? null)) onUpdate({ iterationId: v })
                }}
                disabled={disabled}
              >
                <option value="">No iteration</option>
                {iterations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Release">
              <NativeSelect
                value={item.releaseId ?? ''}
                onChange={(e) => onUpdate({ releaseId: e.target.value || null })}
                disabled={disabled}
              >
                <option value="">No release</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </>
        )}

        {/* Blocked flag */}
        {item.isBlocked && (
          <div
            className="flex items-start gap-2 rounded p-2 text-[11px]"
            style={{
              backgroundColor: BRAND.dangerBg,
              border: `1px solid ${BRAND.dangerBorder}`,
              color: BRAND.danger,
            }}
          >
            <span className="font-semibold">Blocked:</span>
            <span>{item.blockedReason ?? 'Reason not provided.'}</span>
          </div>
        )}

        {/* Tags (labels) */}
        {tags.length > 0 && (
          <FormField label="Tags">
            <LabelChips labels={tags} />
          </FormField>
        )}

        {/* Creation Date (read-only) */}
        <FormField label="Creation Date">
          <span className="block px-1 text-[12px]" style={{ color: BRAND.textSecondary }}>
            {new Date(item.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </FormField>

        {/* Read-only notice */}
        {readOnly && (
          <div
            className="rounded px-3 py-2 text-[10px]"
            style={{
              backgroundColor: BRAND.surfaceHover,
              border: `1px solid ${BRAND.avatarBg}`,
              color: BRAND.textSecondary,
            }}
          >
            You have read-only access to this item.
          </div>
        )}
      </div>
      {/* end p-5 space-y-4 */}
    </aside>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkItemDetailPage() {
  const { itemKey } = useParams({ from: '/auth/item/$itemKey' })
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<DetailTab>('details')
  const [moreOpen, setMoreOpen] = useState(false)
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
    if (!confirm(`Delete ${itemByKey.itemKey}? This cannot be undone.`)) return
    setMoreOpen(false)
    try {
      await deleteMutation.mutateAsync({ id: itemByKey.id, projectId: itemByKey.projectId })
      toast.success(`${itemByKey.itemKey} deleted`)
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
  const taskCount = (item as WorkItem & { _count?: { tasks: number } })._count?.tasks ?? 0

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
                    onClick={() => void handleDelete()}
                    disabled={deleteMutation.isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-red-50 disabled:opacity-50"
                    style={{ color: BRAND.danger }}
                  >
                    <Trash2 size={13} />
                    Delete work item
                  </button>
                </div>
              )}
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
            <TasksTab workItemId={item.id} projectId={item.projectId} />
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
// The API provides GET /v1/work-items?projectId&q=itemKey lookup.
// We use a lightweight search to resolve the work item from the route key.

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
      const { data, error, response } = await apiClient.GET('/v1/work-items', {
        params: {
          query: { projectId, q: itemKey, limit: 5 } as {
            projectId: string
            q?: string
            limit?: number
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      const items = (data as { data?: WorkItem[] } | undefined)?.data ?? []
      return items.find((i) => i.itemKey === itemKey) ?? null
    },
    enabled: !!itemKey && !!projectId,
    staleTime: 15_000,
  })
}
