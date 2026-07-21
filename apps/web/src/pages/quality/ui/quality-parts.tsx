/* eslint-disable react-refresh/only-export-components -- QUALITY_COLUMNS is config that must co-locate with the cell renderers it references */
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { BRAND } from '@/shared/config/brand'
import { notify } from '@/shared/lib/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCreateDefect, qualityKeys, type DefectRow } from '@/features/quality/api'
import { useProjectMembers } from '@/features/teams/api'
import { useReleases } from '@/features/releases/api'
import { useUpdateWorkItem } from '@/features/work-items/api'
import { WorkItemType, type ScheduleState } from '@/entities/work-item/model/types'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { RowGutter } from '@/shared/ui/row-gutter'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { InlineCellSelect } from '@/shared/ui/native-select'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { type ColumnSpec } from '@/shared/ui/table'
import {
  type QualityColKey,
  type QualityCtx,
  SEVERITY_STYLE,
  SEVERITY_OPTIONS,
  PRIORITY_OPTIONS,
  DEFECT_STATE_STYLE,
  DEFECT_STATE_OPTIONS,
  DEFECT_TRANSITIONS,
} from '../model/quality-config'

function DefectStateInlineCell({
  defect,
  canEdit,
}: {
  defect: DefectRow
  canEdit: boolean
  projectId: string
}) {
  const { t } = useTranslation('quality')
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)
  const currentVal = defect.defectState ?? 'submitted'
  const style = DEFECT_STATE_STYLE[currentVal] ?? DEFECT_STATE_STYLE.submitted
  // Only the current state plus its valid next states are selectable; terminal
  // states collapse to a single (unchangeable) option.
  const allowedNext = DEFECT_TRANSITIONS[currentVal] ?? []
  const stateOptions = DEFECT_STATE_OPTIONS.filter(
    (o) => o.value === currentVal || allowedNext.includes(o.value),
  )

  function handleChange(val: string) {
    if (val === currentVal) return
    update.mutate({ defectState: val } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
        notify.success(t('toasts.stateUpdated'))
      },
      onError: () => {
        notify.error(t('errors.stateUpdateFailed'))
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
          {stateOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </InlineCellSelect>
      ) : (
        <span
          className="inline-flex items-center rounded-sm px-1.5 py-px text-ui-xs font-medium"
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
  const { t } = useTranslation('quality')
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  function handleCommit(value: string) {
    const trimmed = value.trim()
    if (trimmed === (defect.fixedInBuild ?? '')) return
    update.mutate({ fixedInBuild: trimmed || null } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
        notify.success(t('toasts.fixedInBuildUpdated'))
      },
      onError: () => {
        notify.error(t('errors.updateFailed'))
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
        className="truncate text-ui-xs text-muted-foreground hover:underline"
        inputClassName="rounded border border-input bg-card px-1 py-0.5 text-ui-xs text-foreground focus:outline-none"
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
  const { t } = useTranslation('quality')
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
              notify.error(t('errors.flowStateUpdateFailed'))
            },
          })
        }
        ariaLabel="Flow state"
      />
    </div>
  )
}

export const QUALITY_COLUMNS: ColumnSpec<DefectRow, QualityCtx, QualityColKey>[] = [
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
      <span className="block truncate text-ui-md font-medium text-foreground">{d.title}</span>
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
        <span className="text-ui-sm text-foreground-faint">—</span>
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
          <span className="text-ui-xs text-foreground-faint">—</span>
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
    cellClassName: 'min-w-0 px-2 text-ui-xs',
    cell: (d) => (
      <span className="block truncate text-muted-foreground" title={d.iterationName ?? ''}>
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
    cellClassName: 'min-w-0 px-2 text-ui-xs',
    cell: (d) => (
      <span className="block truncate text-muted-foreground" title={d.createdByName ?? ''}>
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

export function FilterSelect({
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
      className="rounded border border-border-strong bg-card px-1.5 py-1 text-ui-sm text-muted-foreground focus:outline-none"
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
  const { t } = useTranslation('quality')
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  function handleChange(val: string) {
    if (val === currentValue) return
    update.mutate({ [field]: val || undefined } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
      },
      onError: () => {
        notify.error(t('errors.updateFailed'))
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

export function LogDefectModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation('quality')
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
      setError(t('create.titleRequired'))
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
      notify.success(t('create.logged', { name: title.trim() }))
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('create.logFailed')
      setError(msg)
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('logDefect')} width={480}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        <ModalBody className="space-y-4">
          <FormField label={t('create.titleLabel')} required error={error ?? undefined}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the defect"
              autoFocus
            />
          </FormField>
          <FormField label={t('common:description')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behavior..."
              rows={3}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('create.severityLabel')}>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
              >
                <option value="">—</option>
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t('create.priorityLabel')}>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
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
            <FormField label={t('create.foundInLabel')}>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
              >
                <option value="">—</option>
                {(['development', 'staging', 'production', 'testing'] as const).map((e) => (
                  <option key={e} value={e}>
                    {e.charAt(0).toUpperCase() + e.slice(1)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t('create.rootCauseLabel')}>
              <select
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
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
            <FormField label={t('create.assigneeLabel')}>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
              >
                <option value="">{t('create.unassigned')}</option>
                {(members ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t('create.releaseLabel')}>
              <select
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
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
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={createDefect.isPending || !title.trim()}>
            {createDefect.isPending ? t('create.logging') : t('logDefect')}
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
export function DefectTableRow({
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
      className="group flex h-[34px] cursor-pointer items-center gap-2 border-b border-border-inner px-3 transition-colors duration-100 hover:bg-primary-lighter"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
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
      <div className="w-6 shrink-0 px-2 text-right font-mono text-ui-xs text-foreground-subtle tabular-nums">
        {rowNum}
      </div>
      {renderCells(defect, { canManage, projectId, openItem })}
    </div>
  )
}

// ── Quality page ───────────────────────────────────────────────────────────
