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
import { useIterations } from '@/features/iterations/api'
import { useUpdateWorkItem, useBacklog } from '@/features/work-items/api'
import {
  WorkItemType,
  SCHEDULE_STATE_VALUES,
  SCHEDULE_STATE_LABEL,
} from '@/entities/work-item/model/types'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { OwnerCell, OwnerSelectCell } from '@/shared/ui/owner-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { RowGutter } from '@/shared/ui/row-gutter'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { InlineSelect } from '@/shared/ui/native-select'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { ownerSelectOptions } from '@/shared/ui/owner-cell'
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
      <SearchableSelect
        value={currentVal}
        readOnly={!canEdit || update.isPending}
        ariaLabel="State"
        options={stateOptions.map((o) => ({
          value: o.value,
          label: o.label,
        }))}
        onChange={handleChange}
      />
    </div>
  )
}

/** Name inline editable cell — same click-to-edit input the Iteration Status
 * Name column uses (shared {@link InlineEditableCell}). */
function DefectNameCell({ defect, canEdit }: { defect: DefectRow; canEdit: boolean }) {
  const { t } = useTranslation('quality')
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  function handleCommit(raw: string) {
    const next = raw.trim()
    if (!next || next === defect.title) return
    update.mutate({ title: next } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
        notify.success(t('toasts.nameUpdated'))
      },
      onError: () => {
        notify.error(t('errors.updateFailed'))
      },
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <InlineEditableCell
        value={defect.title}
        canEdit={canEdit}
        onCommit={handleCommit}
        ariaLabel="Name"
        title={defect.title}
        className="block w-full break-words whitespace-normal text-ui-md text-foreground"
        inputClassName="border border-primary text-foreground"
        inputStyle={{
          width: '100%',
          fontSize: 12,
          borderRadius: 2,
          outline: 'none',
          padding: '1px 4px',
        }}
      />
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
        displayValue={defect.fixedInBuild ?? '—'}
        className="block w-full truncate text-ui-xs text-muted-foreground"
        inputClassName="border border-primary text-foreground"
        inputStyle={{
          width: '100%',
          fontSize: 12,
          borderRadius: 2,
          outline: 'none',
          padding: '1px 4px',
        }}
        ariaLabel="Fixed In Build"
        title={defect.fixedInBuild ?? ''}
      />
    </div>
  )
}

/** Iteration inline editable cell — reuses the shared {@link SearchableSelect}
 * (same searchable dropdown the State/Owner cells use). */
function IterationInlineCell({
  defect,
  canEdit,
  projectId,
}: {
  defect: DefectRow
  canEdit: boolean
  projectId: string
}) {
  const { t } = useTranslation('quality')
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)
  const { data: iterations = [] } = useIterations(projectId)

  if (!canEdit) {
    return (
      <span className="block truncate text-muted-foreground" title={defect.iterationName ?? ''}>
        {defect.iterationName ?? '—'}
      </span>
    )
  }

  function handleChange(value: string) {
    const next = value || null
    if (next === (defect.iterationId ?? null)) return
    update.mutate({ iterationId: next } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
        notify.success(t('toasts.iterationUpdated'))
      },
      onError: () => {
        notify.error(t('errors.updateFailed'))
      },
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <SearchableSelect
        value={defect.iterationId ?? ''}
        ariaLabel="Iteration"
        placeholder="—"
        searchPlaceholder="Search"
        options={[
          { value: '', label: '—' },
          ...iterations.map((it) => ({
            value: it.id,
            label: it.iterationKey ? `${it.iterationKey}: ${it.name}` : it.name,
            searchText: `${it.iterationKey ?? ''} ${it.name}`,
            icon: <TypeBadge type="iteration" size={16} />,
          })),
        ]}
        onChange={handleChange}
      />
    </div>
  )
}

/** Owner inline editable cell — reuses the shared {@link OwnerSelectCell} (same
 * searchable member picker the Team Status grid uses). */
function OwnerInlineCell({
  defect,
  canEdit,
  projectId,
}: {
  defect: DefectRow
  canEdit: boolean
  projectId: string
}) {
  const { t } = useTranslation('quality')
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)
  const { data: members = [] } = useProjectMembers(projectId)

  function handleChange(userId: string | null) {
    if (userId === (defect.assigneeId ?? null)) return
    update.mutate({ assigneeId: userId } as never, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: qualityKeys.all })
        notify.success(t('toasts.ownerUpdated'))
      },
      onError: () => {
        notify.error(t('errors.updateFailed'))
      },
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <OwnerSelectCell
        ownerName={defect.assigneeName}
        assigneeId={defect.assigneeId}
        members={members ?? []}
        canEdit={canEdit}
        onChange={handleChange}
      />
    </div>
  )
}

/**
 * Flow State cell — the shared flow-state dropdown ({@link SearchableSelect} over
 * the flow states), bound to `flowState` exactly like the Backlog grid. Reads the
 * mirrored `scheduleState` (BR-WI-01: flowState ↔ scheduleState are kept in sync
 * server-side) and writes `flowState` on change. This is the *Flow State* control,
 * distinct from the Schedule State segmented stepper.
 */
function FlowStateSelectCell({ defect, canEdit }: { defect: DefectRow; canEdit: boolean }) {
  const { t } = useTranslation('quality')
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <SearchableSelect
        value={defect.scheduleState}
        readOnly={!canEdit}
        ariaLabel="Flow state"
        options={SCHEDULE_STATE_VALUES.map((s) => ({ value: s, label: SCHEDULE_STATE_LABEL[s] }))}
        onChange={(next) =>
          update.mutate({ flowState: next } as never, {
            onSuccess: () => {
              void qc.invalidateQueries({ queryKey: qualityKeys.all })
            },
            onError: () => {
              notify.error(t('errors.flowStateUpdateFailed'))
            },
          })
        }
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
    cell: (d, ctx) => <DefectNameCell defect={d} canEdit={ctx.canManage} />,
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
    label: 'Flow State',
    sortCol: 'scheduleState',
    defaultWidth: 132,
    minWidth: 132,
    cellClassName: 'flex items-center px-2 select-none',
    cell: (d, ctx) => <FlowStateSelectCell defect={d} canEdit={ctx.canManage} />,
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
    cellClassName: 'min-w-0 px-2',
    cell: (d, ctx) => (
      <IterationInlineCell defect={d} canEdit={ctx.canManage} projectId={ctx.projectId} />
    ),
  },
  {
    key: 'submittedBy',
    label: 'Submitted By',
    sortCol: 'submittedBy',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'overflow-hidden px-2',
    cell: (d) => <OwnerCell name={d.createdByName} />,
  },
  {
    key: 'owner',
    label: 'Owner',
    sortCol: 'owner',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'overflow-hidden px-2',
    cell: (d, ctx) => (
      <OwnerInlineCell defect={d} canEdit={ctx.canManage} projectId={ctx.projectId} />
    ),
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
    <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
      {label}
      <InlineSelect
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-auto"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </InlineSelect>
    </label>
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
      <SearchableSelect
        value={currentValue}
        readOnly={!canEdit || update.isPending}
        ariaLabel={field}
        placeholder={displayValue}
        options={options}
        onChange={handleChange}
      />
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
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: members } = useProjectMembers(projectId)
  const { data: releases } = useReleases(projectId)
  const { data: backlog } = useBacklog(projectId, { type: 'story' })
  const stories = backlog?.data ?? []
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
        parentId: parentId || undefined,
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
              <SearchableSelect
                variant="field"
                value={severity}
                ariaLabel={t('create.severityLabel')}
                options={[{ value: '', label: '—' }, ...SEVERITY_OPTIONS]}
                onChange={setSeverity}
              />
            </FormField>
            <FormField label={t('create.priorityLabel')}>
              <SearchableSelect
                variant="field"
                value={priority}
                ariaLabel={t('create.priorityLabel')}
                options={PRIORITY_OPTIONS}
                onChange={setPriority}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('create.foundInLabel')}>
              <SearchableSelect
                variant="field"
                value={environment}
                ariaLabel={t('create.foundInLabel')}
                options={[
                  { value: '', label: '—' },
                  ...(['development', 'staging', 'production', 'testing'] as const).map((e) => ({
                    value: e,
                    label: e.charAt(0).toUpperCase() + e.slice(1),
                  })),
                ]}
                onChange={setEnvironment}
              />
            </FormField>
            <FormField label={t('create.rootCauseLabel')}>
              <SearchableSelect
                variant="field"
                value={rootCause}
                ariaLabel={t('create.rootCauseLabel')}
                options={[
                  { value: '', label: '—' },
                  ...(
                    ['requirements', 'design', 'code', 'test', 'integration', 'other'] as const
                  ).map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })),
                ]}
                onChange={setRootCause}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('create.assigneeLabel')}>
              <SearchableSelect
                variant="field"
                value={assigneeId}
                ariaLabel={t('create.assigneeLabel')}
                placeholder={t('create.unassigned')}
                options={ownerSelectOptions(members ?? [], assigneeId)}
                onChange={setAssigneeId}
              />
            </FormField>
            <FormField label={t('create.releaseLabel')}>
              <SearchableSelect
                variant="field"
                value={releaseId}
                ariaLabel={t('create.releaseLabel')}
                options={[
                  { value: '', label: '—' },
                  ...(releases ?? []).map((r) => ({ value: r.id, label: r.name })),
                ]}
                onChange={setReleaseId}
              />
            </FormField>
          </div>
          {/* Optional linked User Story (P3-QA-FR-007) — becomes the defect's parent. */}
          <FormField label={t('create.userStoryLabel', 'User Story')}>
            <SearchableSelect
              variant="field"
              value={parentId}
              ariaLabel={t('create.userStoryLabel', 'User Story')}
              placeholder={t('create.noUserStory', 'No linked story')}
              options={[
                { value: '', label: t('create.noUserStory', 'No linked story') },
                ...stories.map((s) => ({
                  value: s.id,
                  label: `${s.itemKey}: ${s.title}`,
                  searchText: `${s.itemKey} ${s.title}`,
                })),
              ]}
              onChange={setParentId}
            />
          </FormField>
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
      className="group flex min-h-[34px] items-center gap-2 border-b border-border-inner px-3 transition-colors duration-100 hover:bg-primary-lighter"
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
      <div className="w-12 shrink-0 px-2 text-right font-mono text-ui-xs text-foreground-subtle tabular-nums">
        {rowNum}
      </div>
      {renderCells(defect, { canManage, projectId, openItem })}
    </div>
  )
}

// ── Quality page ───────────────────────────────────────────────────────────
