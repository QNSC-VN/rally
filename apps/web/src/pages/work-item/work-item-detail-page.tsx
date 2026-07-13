/**
 * Work Item Detail Page — P1-WI-DETAIL / P1-TASK
 *
 * Route: /item/$itemKey
 * Story/Defect: 3 tabs — Details | Tasks | Revision History
 * Task:         2 tabs — Details | Revision History
 * Sidebar differs by type (task shows time fields + Work Product link).
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
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
import { TypeBadge, ScheduleStateBadge } from '@/entities/work-item/ui/badges'
import {
  SCHEDULE_STATE_VALUES,
  SCHEDULE_STATE_LABEL,
  PRIORITY_VALUES,
  WORK_ITEM_PRIORITY_CONFIG,
} from '@/entities/work-item/model/types'
import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { FormField } from '@/shared/ui/form-field'
import { NativeSelect } from '@/shared/ui/native-select'
import { AddTaskModal } from '@/features/work-items/ui/add-task-modal'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { AttachmentBlock } from '@/features/collaboration/ui/attachment-block'
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
      <h2 className="text-[20px] font-semibold" style={{ color: '#273449' }}>
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
    </div>
  )
}

// ── Tasks tab ─────────────────────────────────────────────────────────────────

// TASK-FR-003: columns Rank, ID, Name, State, Owner, Project, Teams, To Do, Actuals, Estimate.
const TASK_GRID = '44px 56px 72px 1fr 130px 150px 110px 120px 60px 60px 80px'
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
          <h2 className="text-[20px] font-semibold" style={{ color: '#273449' }}>
            Tasks
          </h2>
          <p className="mt-1 text-[11px]" style={{ color: '#64748b' }}>
            Break this work item into trackable delivery tasks.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: BRAND.primary }}
        >
          <Plus size={13} />
          Add Task
        </button>
      </div>

      {isLoading ? (
        <div className="flex h-20 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="overflow-x-auto rounded bg-white" style={{ border: '1px solid #dde2ea' }}>
          <div style={{ minWidth: 1180 }}>
            {/* Header row */}
            <div
              className="grid h-10 items-center"
              style={{
                gridTemplateColumns: TASK_GRID,
                backgroundColor: 'white',
                borderBottom: '2px solid #9fb4d1',
              }}
            >
              {TASK_COLS.map((col, i) => (
                <span
                  key={i}
                  className="flex h-full items-center px-3 text-[12px] font-semibold"
                  style={{
                    color: '#1f2937',
                    borderRight: i < TASK_COLS.length - 1 ? '1px dashed #8c99ad' : undefined,
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
                  backgroundColor: '#f3f6fa',
                  borderBottom: '1px solid #d7dde7',
                  color: '#1f2937',
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
                <p className="text-sm" style={{ color: '#8c94a6' }}>
                  No tasks yet.{' '}
                  <button
                    onClick={() => setShowAdd(true)}
                    className="font-medium"
                    style={{ color: '#2558a6' }}
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
                className="grid min-h-10 cursor-pointer items-center text-[12px] hover:bg-[#f7f8fa]"
                style={{
                  gridTemplateColumns: TASK_GRID,
                  borderBottom: '1px solid #edf0f4',
                  color: '#334155',
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
                <span className="px-3 font-mono text-[11px]" style={{ color: '#5c6478' }}>
                  {task.rank ?? '—'}
                </span>
                <span className="flex items-center gap-1 px-3">
                  <TypeBadge type={task.type} />
                  <span
                    className="font-mono text-[11px] hover:underline"
                    style={{ color: '#2558a6' }}
                  >
                    {task.itemKey}
                  </span>
                </span>
                <span className="truncate px-3 font-medium">{task.title}</span>
                <span className="px-3">
                  <ScheduleStateBadge state={task.scheduleState} dot />
                </span>
                <span className="truncate px-3" style={{ color: '#5c6478' }}>
                  {ownerName(task.assigneeId)}
                </span>
                <span className="truncate px-3" style={{ color: '#5c6478' }}>
                  {projectLabel}
                </span>
                <span className="truncate px-3" style={{ color: '#5c6478' }}>
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

  return (
    <div className="w-full space-y-5">
      <div>
        <h2 className="text-[20px] font-semibold" style={{ color: '#273449' }}>
          Revision History
        </h2>
        <p className="mt-1 text-[12px]" style={{ color: '#64748b' }}>
          Activity log for field changes, task updates, and work item creation.
        </p>
      </div>

      <section className="overflow-hidden rounded bg-white" style={{ border: '1px solid #dde2ea' }}>
        <div
          className="grid px-4 py-2 text-[10px] font-semibold tracking-wider uppercase"
          style={{
            gridTemplateColumns: '160px 180px 160px 1fr',
            color: '#64748b',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #dde2ea',
          }}
        >
          <span>Time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Details</span>
        </div>

        {logs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: '#8c94a6' }}>
            No activity recorded yet.
          </div>
        )}

        {logs.map((log) => {
          const actorName =
            (log as typeof log & { actorName?: string | null }).actorName ?? log.actorId ?? '—'
          const actorInitials = actorName
            .split(' ')
            .slice(0, 2)
            .map((n: string) => n[0]?.toUpperCase())
            .join('')
          return (
            <div
              key={log.id}
              className="grid items-start px-4 py-3 text-[12px]"
              style={{
                gridTemplateColumns: '160px 180px 160px 1fr',
                borderBottom: '1px solid #edf0f4',
                color: '#334155',
              }}
            >
              <span className="font-mono text-[11px]" style={{ color: '#64748b' }}>
                {new Date(log.createdAt).toLocaleString()}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
                  style={{ backgroundColor: '#e5ebf4', color: '#1d3f73' }}
                >
                  {actorInitials}
                </span>
                <span className="truncate">{actorName}</span>
              </span>
              <span className="font-semibold" style={{ color: '#273449' }}>
                {log.action}
              </span>
              <span style={{ color: '#5c6478' }}>
                {(log as typeof log & { detail?: string }).detail ?? '—'}
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
          <h2 className="text-[20px] font-semibold" style={{ color: '#273449' }}>
            Defects
          </h2>
          <p className="mt-0.5 text-[12px]" style={{ color: '#6b7280' }}>
            {defects.length} defect{defects.length !== 1 ? 's' : ''} linked to this story
          </p>
        </div>
      </div>

      {defects.length === 0 ? (
        <div className="rounded py-12 text-center" style={{ border: '1px dashed #d7dde7' }}>
          <Bug size={28} style={{ color: '#c0c7d1', margin: '0 auto 8px' }} />
          <p className="text-[13px] font-medium" style={{ color: '#6b7280' }}>
            No defects linked to this story
          </p>
          <p className="mt-1 text-[11px]" style={{ color: '#9ca3af' }}>
            Create a defect and assign it as a child of this story
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded" style={{ border: '1px solid #d7dde7' }}>
          <div className="min-w-[600px]">
            {/* Header */}
            <div
              className="grid items-center bg-[#f7f8fa] px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase"
              style={{
                gridTemplateColumns: DEFECT_GRID,
                color: '#6b7280',
                borderBottom: '1px solid #d7dde7',
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
                className="grid cursor-pointer items-center px-3 py-2 text-[12px] transition-colors hover:bg-[#f7f8fa]"
                style={{ gridTemplateColumns: DEFECT_GRID, borderBottom: '1px solid #edf0f4' }}
                onClick={() => openDefect(d)}
              >
                <TypeBadge type={d.type} />
                <span className="truncate font-medium" style={{ color: '#273449' }}>
                  {d.title}
                </span>
                <ScheduleStateBadge state={d.scheduleState} dot />
                <span style={{ color: '#5c6478' }}>{d.priority}</span>
                <span style={{ color: '#5c6478' }}>{ownerName(d.assigneeId)}</span>
                <span style={{ color: '#5c6478' }}>
                  {(d as unknown as { severity?: string }).severity ?? '—'}
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
  const { data: parentItem } = useWorkItem(
    item.type === 'task' || item.type === 'defect' ? (item.parentId ?? undefined) : undefined,
  )
  const isTask = item.type === 'task'
  const isDefect = item.type === 'defect'
  const disabled = updating || readOnly

  const SCHEDULE_STATES = SCHEDULE_STATE_VALUES.map((v) => ({
    value: v,
    label: SCHEDULE_STATE_LABEL[v],
  }))
  const PRIORITIES = PRIORITY_VALUES.map((v) => ({
    value: v,
    label: WORK_ITEM_PRIORITY_CONFIG[v].label,
  }))

  // When collapsed, render nothing — the page-level "re-open" tab handles visibility
  if (collapsed) return null

  return (
    <aside
      className="w-[300px] shrink-0 overflow-y-auto bg-white"
      style={{ borderLeft: '1px solid #d7dde7' }}
    >
      {/* Collapse toggle header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between bg-white px-3 py-2"
        style={{ borderBottom: '1px solid #e7ebf0' }}
      >
        <span
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: '#6b7280' }}
        >
          Details
        </span>
        <div className="flex items-center gap-2">
          {saveStatus && <SaveIndicator status={saveStatus} errorMsg={saveErrorMsg} />}
          <button
            onClick={onToggleCollapse}
            title="Hide sidebar"
            className="rounded p-1 transition-colors hover:bg-[#f3f5f8]"
          >
            <PanelRightClose size={14} style={{ color: '#6b7280' }} />
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Schedule State */}
        <FormField label="Schedule State">
          <NativeSelect
            value={item.scheduleState ?? ''}
            onChange={(e) => {
              const v = e.target.value as WorkItem['scheduleState']
              if (v !== item.scheduleState) onUpdate({ scheduleState: v })
            }}
            disabled={disabled}
          >
            {SCHEDULE_STATES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
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

        {/* Task: Work Product (parent link) */}
        {isTask && item.parentId && (
          <FormField label="Work Product">
            <Link
              to={'/item/$itemKey'}
              params={{ itemKey: parentItem?.itemKey ?? item.parentId }}
              className="flex items-center gap-1.5 truncate rounded px-3 py-2 text-[12px] hover:bg-slate-50"
              style={{ border: '1px solid #d7dde7', color: '#2558a6' }}
            >
              {parentItem && <TypeBadge type={parentItem.type} />}
              {parentItem?.itemKey ?? item.parentId}
            </Link>
          </FormField>
        )}

        {/* Defect: Parent Story link */}
        {isDefect && (
          <FormField label="Parent Story">
            {disabled ? (
              item.parentId ? (
                <Link
                  to={'/item/$itemKey'}
                  params={{ itemKey: parentItem?.itemKey ?? item.parentId! }}
                  className="block truncate rounded px-3 py-2 text-[12px] hover:bg-slate-50"
                  style={{ border: '1px solid #d7dde7', color: '#2558a6' }}
                >
                  {parentItem && <TypeBadge type={parentItem.type} />}
                  {parentItem ? `${parentItem.itemKey} — ${parentItem.title}` : item.parentId}
                </Link>
              ) : (
                <span
                  className="block rounded px-3 py-2 text-[12px]"
                  style={{ border: '1px solid #d7dde7', color: '#9ca3af' }}
                >
                  No parent story
                </span>
              )
            ) : (
              <ParentStorySelect
                projectId={item.projectId}
                currentParentId={item.parentId}
                onUpdate={(patch) => onUpdate(patch)}
              />
            )}
          </FormField>
        )}

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
            style={{ backgroundColor: '#fef2f2', border: '1px solid #fcc5c0', color: '#b91c1c' }}
          >
            <span className="font-semibold">Blocked:</span>
            <span>{item.blockedReason ?? 'Reason not provided.'}</span>
          </div>
        )}

        {/* Read-only notice */}
        {readOnly && (
          <div
            className="rounded px-3 py-2 text-[10px]"
            style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b' }}
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
        <p className="text-sm font-medium" style={{ color: '#5c6478' }}>
          Work item "{itemKey}" not found.
        </p>
        <button
          onClick={() => void navigate({ to: '/backlog' })}
          className="text-xs font-medium"
          style={{ color: '#2558a6' }}
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
                {taskCount > 0 && (
                  <span className="text-[10px] font-semibold tabular-nums">{taskCount}</span>
                )}
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
                {defectCount > 0 && (
                  <span className="text-[10px] font-semibold tabular-nums">{defectCount}</span>
                )}
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
      <div className="shrink-0 text-white" style={{ backgroundColor: '#173f78' }}>
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
              style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#d7e4f7' }}
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
              color: isWatching ? 'white' : '#d7e4f7',
              border: '1px solid',
              borderColor: isWatching ? 'rgba(255,255,255,0.3)' : 'transparent',
            }}
          >
            {isWatching ? <BellOff size={14} /> : <Bell size={14} />}
            <span>{isWatching ? 'Watching' : 'Watch'}</span>
          </button>

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
                style={{ backgroundColor: 'white', border: '1px solid #d7dde7' }}
              >
                {!readOnly && (
                  <button
                    onClick={() => void handleDelete()}
                    disabled={deleteMutation.isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-red-50 disabled:opacity-50"
                    style={{ color: '#b91c1c' }}
                  >
                    <Trash2 size={13} />
                    Delete work item
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tab row */}
        <div className="flex h-16 items-stretch gap-2 px-5">
          {tabs.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex flex-col items-center justify-center gap-1 px-4 text-[11px] font-medium"
              style={{
                backgroundColor: activeTab === id ? '#2f6fc5' : 'transparent',
                color: activeTab === id ? 'white' : '#d7e4f7',
              }}
            >
              <span className="flex h-5 items-center justify-center">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1" style={{ backgroundColor: '#e7ebf0' }}>
        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#f3f5f8' }}>
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
            className="flex w-6 shrink-0 items-center justify-center transition-colors hover:bg-[#e0e4ea]"
            style={{ borderLeft: '1px solid #d7dde7', backgroundColor: '#f3f5f8' }}
          >
            <PanelRightOpen size={14} style={{ color: '#6b7280' }} />
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
