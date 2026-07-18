/**
 * Quality / Defect Tracking — P3.4
 *
 * Shows defect metrics strip + filterable defect table for the active project.
 * SRS layout (row-number gutter, then columns): ID, Name, User Story, Severity,
 * Priority, State, Schedule State, Fixed In Build, Iteration, Submitted By, Owner
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, PackageOpen, Plus } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { RowGutter } from '@/shared/ui/row-gutter'
import { SkeletonList } from '@/shared/ui/skeleton'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { BRAND } from '@/shared/config/brand'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import {
  WorkItemType,
  WorkItemPriority,
  DEFECT_SEVERITY_CONFIG,
  DEFECT_SEVERITY_OPTIONS,
  PRIORITY_LABEL,
  SCHEDULE_STATE_VALUES,
  SCHEDULE_STATE_LABEL,
  type ScheduleState,
} from '@/entities/work-item/model/types'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { InlineCellSelect } from '@/shared/ui/native-select'
import { BulkScheduleBar } from '@/features/work-items/ui/bulk-schedule-bar'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useDefects, useCreateDefect, qualityKeys, type DefectRow } from '@/features/quality/api'
import { useProjectMembers } from '@/features/teams/api'
import { useReleases } from '@/features/releases/api'
import { useIterations } from '@/features/iterations/api'
import { useUpdateWorkItem, useRankAnyWorkItem } from '@/features/work-items/api'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { useQueryClient } from '@tanstack/react-query'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { DataTableHeader } from '@/shared/ui/data-table-header'
import { useDataTable, useRowRerank, type ColumnSpec } from '@/shared/ui/table'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'

// ── Constants ──────────────────────────────────────────────────────────────

/** Severity labels/colours + option list come from the shared entity config. */
const SEVERITY_STYLE = DEFECT_SEVERITY_CONFIG
const SEVERITY_OPTIONS = DEFECT_SEVERITY_OPTIONS

/** Flow State (schedule state) options — derived from the shared entity config
 * so the defect page can never drift from the canonical schedule-state set. */
const FLOW_STATE_OPTIONS: { value: string; label: string }[] = SCHEDULE_STATE_VALUES.map((v) => ({
  value: v,
  label: SCHEDULE_STATE_LABEL[v],
}))

// Labels sourced from the shared work-item config (single source of truth);
// order is defect-page specific (most-urgent first).
const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  WorkItemPriority.None,
  WorkItemPriority.Urgent,
  WorkItemPriority.High,
  WorkItemPriority.Normal,
  WorkItemPriority.Low,
].map((v) => ({ value: v, label: PRIORITY_LABEL[v] }))

const DEFECT_STATE_STYLE: Record<
  string,
  { bg: string; text: string; border: string; label: string }
> = {
  submitted: {
    bg: BRAND.primaryLighter,
    text: BRAND.primaryLight,
    border: BRAND.primaryLighter,
    label: 'Submitted',
  },
  open: { bg: BRAND.warningBg, text: BRAND.warning, border: BRAND.warningBorder, label: 'Open' },
  fixed: { bg: BRAND.successBg, text: BRAND.success, border: BRAND.successBorder, label: 'Fixed' },
  closed: {
    bg: BRAND.primaryLighter,
    text: BRAND.textSecondary,
    border: BRAND.border,
    label: 'Closed',
  },
  closed_declined: {
    bg: BRAND.dangerBg,
    text: BRAND.danger,
    border: BRAND.dangerBorder,
    label: 'Closed Declined',
  },
}

const DEFECT_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'open', label: 'Open' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'closed', label: 'Closed' },
  { value: 'closed_declined', label: 'Closed Declined' },
]

function DefectStateInlineCell({
  defect,
  canEdit,
}: {
  defect: DefectRow
  canEdit: boolean
  projectId: string
}) {
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)
  const currentVal = defect.defectState ?? 'submitted'
  const style = DEFECT_STATE_STYLE[currentVal] ?? DEFECT_STATE_STYLE.submitted

  function handleChange(val: string) {
    if (val === currentVal) return
    update.mutate({ defectState: val } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
        toast.success('Defect state updated')
      },
      onError: () => {
        toast.error('Failed to update defect state')
      },
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {canEdit ? (
        <InlineCellSelect
          value={currentVal}
          displayValue={style.label}
          onChange={(e) => handleChange(e.target.value)}
          disabled={update.isPending}
        >
          {DEFECT_STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </InlineCellSelect>
      ) : (
        <span
          className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium"
          style={{
            backgroundColor: style.bg,
            color: style.text,
            border: `1px solid ${style.border}`,
          }}
        >
          {style.label}
        </span>
      )}
    </div>
  )
}

/** Fixed In Build inline editable cell */
function FixedInBuildCell({
  defect,
  canEdit,
}: {
  defect: DefectRow
  canEdit: boolean
  projectId: string
}) {
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  function handleCommit(value: string) {
    const trimmed = value.trim()
    if (trimmed === (defect.fixedInBuild ?? '')) return
    update.mutate({ fixedInBuild: trimmed || null } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
        toast.success('Fixed In Build updated')
      },
      onError: () => {
        toast.error('Failed to update')
      },
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <InlineEditableCell
        value={defect.fixedInBuild ?? ''}
        canEdit={canEdit}
        onCommit={handleCommit}
        trigger="dblclick"
        displayValue={defect.fixedInBuild ?? '—'}
        className="truncate text-[10px] hover:underline"
        style={{ color: BRAND.textSecondary }}
        inputClassName="text-[10px] px-1 py-0.5 rounded focus:outline-none"
        inputStyle={{
          border: `1px solid ${BRAND.borderInput}`,
          backgroundColor: 'white',
          color: BRAND.textPrimary,
        }}
        ariaLabel="Fixed In Build"
        title={defect.fixedInBuild ?? ''}
      />
    </div>
  )
}

/**
 * Flow State cell — the schedule-state segmented stepper, identical to the
 * Iteration Status grid (shared {@link StateStepper} + {@link SCHEDULE_STATE_STEPS}).
 * Single visual language for schedule state across every work-item grid.
 */
function FlowStateStepperCell({ defect, canEdit }: { defect: DefectRow; canEdit: boolean }) {
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <StateStepper
        steps={SCHEDULE_STATE_STEPS}
        value={defect.scheduleState as ScheduleState}
        canEdit={canEdit}
        onChange={(next) =>
          update.mutate({ scheduleState: next } as never, {
            onSuccess: () => {
              void qc.invalidateQueries({ queryKey: qualityKeys.all })
            },
            onError: () => {
              toast.error('Failed to update flow state')
            },
          })
        }
        ariaLabel="Flow state"
      />
    </div>
  )
}

type QualityColKey =
  | 'id'
  | 'name'
  | 'userStory'
  | 'severity'
  | 'priority'
  | 'state'
  | 'flowState'
  | 'fixedInBuild'
  | 'iteration'
  | 'submittedBy'
  | 'owner'

interface QualityCtx {
  canManage: boolean
  projectId: string
  openItem: (itemKey: string) => void
}

/** Logical (not alphabetical) sort order for the categorical columns. */
const SEVERITY_SORT: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
const PRIORITY_SORT: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3, none: 4 }
const DEFECT_STATE_SORT: Record<string, number> = {
  submitted: 0,
  open: 1,
  fixed: 2,
  closed: 3,
  closed_declined: 4,
}

/** Resolve a comparable value for a defect column key (drives click-to-sort). */
function defectSortValue(d: DefectRow, col: string): string | number {
  switch (col) {
    case 'id':
      return d.itemKey
    case 'name':
      return d.title.toLowerCase()
    case 'userStory':
      return (d.parentKey ?? '').toLowerCase()
    case 'severity':
      return SEVERITY_SORT[d.severity ?? 'none'] ?? 99
    case 'priority':
      return PRIORITY_SORT[d.priority] ?? 99
    case 'state':
      return DEFECT_STATE_SORT[d.defectState ?? 'submitted'] ?? 99
    case 'scheduleState': {
      // Sort by canonical maturity order; unknown states sort last.
      const idx = SCHEDULE_STATE_VALUES.indexOf(d.scheduleState as ScheduleState)
      return idx === -1 ? 99 : idx
    }
    case 'fixedInBuild':
      return (d.fixedInBuild ?? '').toLowerCase()
    case 'iteration':
      return (d.iterationName ?? '').toLowerCase()
    case 'submittedBy':
      return (d.createdByName ?? '').toLowerCase()
    case 'owner':
      return (d.assigneeName ?? '').toLowerCase()
    default:
      return ''
  }
}

/**
 * Column catalog — the single source of truth for the Defects grid. Each entry
 * declares its layout (width/lock/align) AND its body-cell renderer, so the
 * shared {@link useDataTable} engine derives the header, resize/reorder/show-hide
 * behaviour and row cells from this one array (Broadcom-style config-driven grid).
 */
const QUALITY_COLUMNS: ColumnSpec<DefectRow, QualityCtx, QualityColKey>[] = [
  {
    key: 'id',
    label: 'ID',
    sortCol: 'id',
    defaultWidth: 104,
    minWidth: 84,
    locked: true,
    cellClassName: 'overflow-hidden px-2',
    cell: (d, ctx) => (
      <IdCell type={d.type} itemKey={d.itemKey} onOpen={() => ctx.openItem(d.itemKey)} />
    ),
  },
  {
    key: 'name',
    label: 'Name',
    sortCol: 'name',
    defaultWidth: 200,
    minWidth: 120,
    locked: true,
    cellClassName: 'min-w-0 px-2',
    cell: (d) => (
      <span className="block truncate text-[12px] font-medium" style={{ color: BRAND.textPrimary }}>
        {d.title}
      </span>
    ),
  },
  {
    key: 'userStory',
    label: 'User Story',
    sortCol: 'userStory',
    defaultWidth: 140,
    minWidth: 80,
    cellClassName: 'flex min-w-0 items-center px-2',
    cell: (d, ctx) =>
      d.parentKey ? (
        <WorkItemRefCell
          type={WorkItemType.Story}
          itemKey={d.parentKey}
          title={d.parentTitle}
          onOpen={() => ctx.openItem(d.parentKey!)}
        />
      ) : (
        <span className="text-[11px]" style={{ color: BRAND.textFaint }}>
          —
        </span>
      ),
  },
  {
    key: 'severity',
    label: 'Severity',
    sortCol: 'severity',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'px-2',
    cell: (d, ctx) => {
      const sevStyle = d.severity && d.severity !== 'none' ? SEVERITY_STYLE[d.severity] : null
      return sevStyle ? (
        <DefectInlineCell
          defect={d}
          field="severity"
          options={SEVERITY_OPTIONS}
          currentValue={d.severity!}
          displayValue={sevStyle.label}
          canEdit={ctx.canManage}
          projectId={ctx.projectId}
        />
      ) : (
        <div onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px]" style={{ color: BRAND.textFaint }}>
            —
          </span>
        </div>
      )
    },
  },
  {
    key: 'priority',
    label: 'Priority',
    sortCol: 'priority',
    defaultWidth: 80,
    minWidth: 60,
    cellClassName: 'px-2',
    cell: (d, ctx) => (
      <DefectInlineCell
        defect={d}
        field="priority"
        options={PRIORITY_OPTIONS}
        currentValue={d.priority}
        displayValue={
          d.priority === 'none' ? '—' : d.priority.charAt(0).toUpperCase() + d.priority.slice(1)
        }
        canEdit={ctx.canManage}
        projectId={ctx.projectId}
      />
    ),
  },
  {
    key: 'state',
    label: 'State',
    sortCol: 'state',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'px-2',
    cell: (d, ctx) => (
      <DefectStateInlineCell defect={d} canEdit={ctx.canManage} projectId={ctx.projectId} />
    ),
  },
  {
    key: 'flowState',
    label: 'Schedule State',
    sortCol: 'scheduleState',
    defaultWidth: 132,
    minWidth: 132,
    cellClassName: 'flex items-center px-2 select-none',
    cell: (d, ctx) => <FlowStateStepperCell defect={d} canEdit={ctx.canManage} />,
  },
  {
    key: 'fixedInBuild',
    label: 'Fixed In Build',
    sortCol: 'fixedInBuild',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'px-2',
    cell: (d, ctx) => (
      <FixedInBuildCell defect={d} canEdit={ctx.canManage} projectId={ctx.projectId} />
    ),
  },
  {
    key: 'iteration',
    label: 'Iteration',
    sortCol: 'iteration',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'min-w-0 px-2 text-[10px]',
    cell: (d) => (
      <span
        className="block truncate"
        style={{ color: BRAND.textSecondary }}
        title={d.iterationName ?? ''}
      >
        {d.iterationName ?? '—'}
      </span>
    ),
  },
  {
    key: 'submittedBy',
    label: 'Submitted By',
    sortCol: 'submittedBy',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'min-w-0 px-2 text-[10px]',
    cell: (d) => (
      <span
        className="block truncate"
        style={{ color: BRAND.textSecondary }}
        title={d.createdByName ?? ''}
      >
        {d.createdByName ?? '—'}
      </span>
    ),
  },
  {
    key: 'owner',
    label: 'Owner',
    sortCol: 'owner',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'overflow-hidden px-2',
    cell: (d) => <OwnerCell name={d.assigneeName} />,
  },
]

// ── Small filter select ───────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded bg-white px-1.5 py-1 text-[11px] focus:outline-none"
      style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
      aria-label={label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ── Inline cell handlers ───────────────────────────────────────────────────

function DefectInlineCell({
  defect,
  field,
  options,
  currentValue,
  displayValue,
  canEdit,
}: {
  defect: DefectRow
  field: 'severity' | 'priority' | 'scheduleState'
  options: { value: string; label: string }[]
  currentValue: string
  displayValue: string
  canEdit: boolean
  projectId: string
}) {
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  function handleChange(val: string) {
    if (val === currentValue) return
    update.mutate({ [field]: val || undefined } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
      },
      onError: () => {
        toast.error('Failed to update')
      },
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <InlineCellSelect
        value={currentValue}
        displayValue={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        disabled={!canEdit || update.isPending}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </InlineCellSelect>
    </div>
  )
}

// ── Log Defect modal ───────────────────────────────────────────────────────

function LogDefectModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('')
  const [priority, setPriority] = useState('normal')
  const [environment, setEnvironment] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [releaseId, setReleaseId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: members } = useProjectMembers(projectId)
  const { data: releases } = useReleases(projectId)
  const createDefect = useCreateDefect()

  async function handleSubmit() {
    setError(null)
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    try {
      await createDefect.mutateAsync({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        severity: severity || undefined,
        priority,
        foundInEnvironment: environment || undefined,
        rootCause: rootCause || undefined,
        assigneeId: assigneeId || undefined,
        releaseId: releaseId || undefined,
      })
      toast.success(`Defect "${title.trim()}" logged`)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to log defect'
      setError(msg)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title="Log Defect" width={480}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        <ModalBody className="space-y-4">
          <FormField label="Title" required error={error ?? undefined}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the defect"
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behavior..."
              rows={3}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Severity">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
              >
                <option value="">—</option>
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Found In">
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
              >
                <option value="">—</option>
                {(['development', 'staging', 'production', 'testing'] as const).map((e) => (
                  <option key={e} value={e}>
                    {e.charAt(0).toUpperCase() + e.slice(1)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Root Cause">
              <select
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
              >
                <option value="">—</option>
                {(['requirements', 'design', 'code', 'test', 'integration', 'other'] as const).map(
                  (r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ),
                )}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Assignee">
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
              >
                <option value="">Unassigned</option>
                {(members ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Release">
              <select
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
              >
                <option value="">—</option>
                {(releases ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createDefect.isPending || !title.trim()}>
            {createDefect.isPending ? 'Logging...' : 'Log Defect'}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Defect row (draggable) ───────────────────────────────────────────────────

interface DefectTableRowProps {
  defect: DefectRow
  rowNum: number
  canManage: boolean
  projectId: string
  dragDisabled: boolean
  selected: boolean
  onToggleSelect: () => void
  openItem: (itemKey: string) => void
  renderCells: (row: DefectRow, ctx: QualityCtx) => ReactNode
}

/**
 * One Defects grid row. Owns its DnD wiring (dnd-kit `useSortable`) while the
 * engine's `renderCells` owns the column cells — so row structure (drag grip,
 * row nav) stays page-local and the columns stay DRY. Rank persistence + the
 * optimistic ordering are handled by the shared {@link useRowRerank}.
 */
function DefectTableRow({
  defect,
  rowNum,
  canManage,
  projectId,
  dragDisabled,
  selected,
  onToggleSelect,
  openItem,
  renderCells,
}: DefectTableRowProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: defect.id })
  return (
    <div
      ref={setNodeRef}
      className="group flex h-[34px] cursor-pointer items-center gap-2 px-3 transition-colors duration-100 hover:bg-primary-lighter"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        borderBottom: `1px solid ${BRAND.borderInner}`,
        minWidth: 'max-content',
        backgroundColor: isDragging
          ? BRAND.primaryLighter
          : selected
            ? BRAND.surfaceSubtle
            : undefined,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 1 : undefined,
        position: isDragging ? 'relative' : undefined,
      }}
      onClick={() => openItem(defect.itemKey)}
      {...attributes}
    >
      <RowGutter
        ref={setActivatorNodeRef}
        dragListeners={listeners}
        dragDisabled={dragDisabled}
        stopPropagation
        checkbox={{
          checked: selected,
          onChange: onToggleSelect,
          ariaLabel: `Select ${defect.itemKey}`,
        }}
      />
      <div
        className="w-6 shrink-0 px-2 text-right font-mono text-[10px] tabular-nums"
        style={{ color: BRAND.textMuted }}
      >
        {rowNum}
      </div>
      {renderCells(defect, { canManage, projectId, openItem })}
    </div>
  )
}

// ── Quality page ───────────────────────────────────────────────────────────

export function QualityPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { project } = useAppContext()
  const { can } = useProjectPermissions(project?.projectId)
  const canManage = can('quality:edit')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Toggle asc/desc on the active column, else switch to a new column (asc).
  // NOTE: never nest a setter inside another setter's updater — StrictMode
  // double-invokes updaters and would cancel the toggle.
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
  const table = useDataTable<DefectRow, QualityCtx, QualityColKey>(QUALITY_COLUMNS, {
    storageKey: STORAGE_KEYS.QUALITY_COLUMNS,
    leadingWidth: 84,
    sort: { col: sortCol, dir: sortDir, onSort: handleSort },
  })
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [envFilter, setEnvFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [releaseFilter, setReleaseFilter] = useState('all')
  const [rootCauseFilter, setRootCauseFilter] = useState('all')
  const [resolutionFilter, setResolutionFilter] = useState('all')
  const [defectStateFilter, setDefectStateFilter] = useState('all')
  const [showLogDefect, setShowLogDefect] = useState(false)
  const { data: members } = useProjectMembers(project?.projectId)
  const { data: releases } = useReleases(project?.projectId)

  const { data, isLoading, error } = useDefects(project?.projectId, {
    search: search || undefined,
    severity: severityFilter,
    environment: envFilter,
    priority: priorityFilter,
    scheduleState: stateFilter,
    assigneeId: ownerFilter !== 'all' ? ownerFilter : undefined,
    releaseId: releaseFilter !== 'all' ? releaseFilter : undefined,
    rootCause: rootCauseFilter,
    resolution: resolutionFilter,
    defectState: defectStateFilter,
  })

  const defects = useMemo(() => data?.data ?? [], [data])
  const sortedDefects = useMemo(() => {
    if (!sortCol) return defects
    const dir = sortDir === 'asc' ? 1 : -1
    return [...defects].sort((a, b) => {
      const va = defectSortValue(a, sortCol)
      const vb = defectSortValue(b, sortCol)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [defects, sortCol, sortDir])
  // Row drag-to-rerank (shared engine capability). Disabled while a column
  // sort is active — rank only has meaning in natural rank order.
  const rankMutation = useRankAnyWorkItem()
  const rerank = useRowRerank({
    items: sortedDefects,
    disabled: sortCol !== null,
    onReorder: ({ id, beforeId, afterId }) =>
      rankMutation.mutate(
        {
          id,
          projectId: project?.projectId ?? '',
          beforeId: beforeId ?? undefined,
          afterId: afterId ?? undefined,
        },
        { onError: (err) => toast.error(err.message) },
      ),
  })

  // ── Bulk selection (shared pattern: checkbox gutter + BulkScheduleBar) ────────
  const { data: iterations = [] } = useIterations(project?.projectId)
  const {
    selectedIds,
    allSelected,
    someSelected,
    isSelected,
    toggle: toggleSelect,
    toggleAll,
    clear: clearSelection,
  } = useRowSelection(sortedDefects)

  const metrics = data?.metrics ?? {
    openDefects: 0,
    critical: 0,
    inProgress: 0,
    verifiedAccepted: 0,
    reopened: 0,
    blockers: 0,
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <AlertTriangle size={32} style={{ color: BRAND.danger }} />
        <p className="text-sm" style={{ color: BRAND.textSecondary }}>
          {error instanceof Error ? error.message : 'Failed to load defects'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Metrics strip */}
      <MetricStrip>
        <MetricCard
          label="Open Defects"
          value={metrics.openDefects}
          valueColor={BRAND.warning}
          minWidth={100}
        />
        <MetricCard
          label="Critical"
          value={metrics.critical}
          valueColor={BRAND.danger}
          minWidth={80}
        />
        <MetricCard
          label="In Progress"
          value={metrics.inProgress}
          valueColor={BRAND.primaryLight}
          minWidth={90}
        />
        <MetricCard
          label="Verified / Accepted"
          value={metrics.verifiedAccepted}
          valueColor={BRAND.success}
          minWidth={130}
        />
        <MetricCard
          label="Reopened"
          value={metrics.reopened}
          valueColor={BRAND.textPrimary}
          minWidth={90}
        />
        <MetricCard
          label="Blockers"
          value={metrics.blockers}
          valueColor={metrics.blockers > 0 ? BRAND.danger : BRAND.textPrimary}
          minWidth={80}
        />
      </MetricStrip>

      {/* Toolbar */}
      <PageToolbar
        title="Defects"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search defects…',
          ariaLabel: 'Search defects',
          width: 160,
        }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setShowLogDefect(true)}>
              <Plus size={12} />
              Log Defect
            </Button>
          ) : undefined
        }
        activeFilterCount={
          (severityFilter !== 'all' ? 1 : 0) +
          (envFilter !== 'all' ? 1 : 0) +
          (priorityFilter !== 'all' ? 1 : 0) +
          (stateFilter !== 'all' ? 1 : 0) +
          (defectStateFilter !== 'all' ? 1 : 0) +
          (ownerFilter !== 'all' ? 1 : 0) +
          (releaseFilter !== 'all' ? 1 : 0) +
          (rootCauseFilter !== 'all' ? 1 : 0) +
          (resolutionFilter !== 'all' ? 1 : 0)
        }
        filters={
          <>
            <FilterSelect
              label="Severity"
              value={severityFilter}
              onChange={setSeverityFilter}
              options={[{ value: 'all', label: 'All Severity' }, ...SEVERITY_OPTIONS]}
            />

            <FilterSelect
              label="Environment"
              value={envFilter}
              onChange={setEnvFilter}
              options={[
                { value: 'all', label: 'All Env' },
                { value: 'development', label: 'Development' },
                { value: 'staging', label: 'Staging' },
                { value: 'production', label: 'Production' },
                { value: 'testing', label: 'Testing' },
              ]}
            />

            <FilterSelect
              label="Priority"
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={[{ value: 'all', label: 'All Priority' }, ...PRIORITY_OPTIONS]}
            />

            <FilterSelect
              label="Flow State"
              value={stateFilter}
              onChange={setStateFilter}
              options={[{ value: 'all', label: 'All Flow States' }, ...FLOW_STATE_OPTIONS]}
            />

            <FilterSelect
              label="Defect State"
              value={defectStateFilter}
              onChange={setDefectStateFilter}
              options={[{ value: 'all', label: 'All Defect States' }, ...DEFECT_STATE_OPTIONS]}
            />

            <FilterSelect
              label="Owner"
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { value: 'all', label: 'All Owners' },
                ...(members ?? []).map((m) => ({
                  value: m.userId,
                  label: m.displayName ?? m.email ?? m.userId,
                })),
              ]}
            />

            <FilterSelect
              label="Release"
              value={releaseFilter}
              onChange={setReleaseFilter}
              options={[
                { value: 'all', label: 'All Releases' },
                ...(releases ?? []).map((r) => ({ value: r.id, label: r.name })),
              ]}
            />

            <FilterSelect
              label="Root Cause"
              value={rootCauseFilter}
              onChange={setRootCauseFilter}
              options={[
                { value: 'all', label: 'All Root Causes' },
                { value: 'requirements', label: 'Requirements' },
                { value: 'design', label: 'Design' },
                { value: 'code', label: 'Code' },
                { value: 'test', label: 'Test' },
                { value: 'integration', label: 'Integration' },
                { value: 'other', label: 'Other' },
              ]}
            />

            <FilterSelect
              label="Resolution"
              value={resolutionFilter}
              onChange={setResolutionFilter}
              options={[
                { value: 'all', label: 'All Resolutions' },
                { value: 'unresolved', label: 'Open (Unresolved)' },
                { value: 'fixed', label: 'Fixed' },
                { value: 'wont_fix', label: "Won't Fix" },
                { value: 'duplicate', label: 'Duplicate' },
                { value: 'cannot_reproduce', label: 'Cannot Reproduce' },
                { value: 'deferred', label: 'Deferred' },
                { value: 'by_design', label: 'By Design' },
              ]}
            />
          </>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* Bulk action bar — appears when ≥1 defect is selected */}
      <BulkScheduleBar
        projectId={project?.projectId}
        selectedIds={selectedIds}
        clearSelection={clearSelection}
        releases={releases ?? []}
        iterations={iterations}
        canEdit={canManage}
        onAssigned={() => qc.invalidateQueries({ queryKey: qualityKeys.all })}
      />

      {/* Defect table */}
      <div className="flex flex-1 overflow-hidden bg-white">
        {isLoading ? (
          <SkeletonList rows={8} />
        ) : defects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
            <PackageOpen size={40} style={{ color: BRAND.textFaint }} />
            <p className="text-sm" style={{ color: BRAND.textMuted }}>
              {search ||
              severityFilter !== 'all' ||
              envFilter !== 'all' ||
              priorityFilter !== 'all' ||
              stateFilter !== 'all'
                ? 'No defects match your filters'
                : 'No defects logged yet'}
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-auto">
              <div style={{ width: table.tableWidth, minWidth: '100%' }}>
                {/* Header */}
                <DataTableHeader
                  {...table.headerProps}
                  className="gap-2 px-3"
                  leading={
                    <>
                      <RowGutter
                        dragDisabled
                        checkbox={{
                          checked: allSelected,
                          indeterminate: someSelected,
                          onChange: toggleAll,
                          ariaLabel: 'Select all',
                        }}
                      />
                      <div className="w-6 shrink-0 px-2 text-right">#</div>
                    </>
                  }
                />
                {/* Rows */}
                <DndContext {...rerank.dndContextProps}>
                  <SortableContext {...rerank.sortableContextProps}>
                    {rerank.items.map((d, idx) => (
                      <DefectTableRow
                        key={d.id}
                        defect={d}
                        rowNum={idx + 1}
                        canManage={canManage}
                        projectId={project?.projectId ?? ''}
                        dragDisabled={sortCol !== null}
                        selected={isSelected(d.id)}
                        onToggleSelect={() => toggleSelect(d.id)}
                        openItem={(k) => navigate({ to: '/item/$itemKey', params: { itemKey: k } })}
                        renderCells={table.renderCells}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Log Defect Modal */}
      {showLogDefect && (
        <LogDefectModal
          projectId={project?.projectId ?? ''}
          onClose={() => setShowLogDefect(false)}
        />
      )}
    </div>
  )
}
