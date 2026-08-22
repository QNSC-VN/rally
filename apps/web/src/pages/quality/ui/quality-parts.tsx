/* eslint-disable react-refresh/only-export-components -- QUALITY_COLUMNS is config that must co-locate with the cell renderers it references */
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { BRAND } from '@/shared/config/brand'
import { notify } from '@/shared/lib/toast'
import { useCreateDefect, type DefectRow } from '@/features/quality/api'
import { useProjectMemberOptions, useProjectTeams } from '@/features/teams/api'
import { useProjectTeamScope } from '@/features/access/api'
import { listResource } from '@/shared/lib/query/resource'
import { useReleases } from '@/features/releases/api'
import { useIterationOptions } from '@/features/iterations/api'
import { useUpdateWorkItem, useStoryOptions } from '@/features/work-items/api'
import {
  WorkItemType,
  SCHEDULE_STATE_VALUES,
  SCHEDULE_STATE_LABEL,
} from '@/entities/work-item/model/types'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { OwnerCell, OwnerSelectCell } from '@/shared/ui/owner-cell'
import { TeamSelectField } from '@/shared/ui/entity-select-field'
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
import { type ColumnSpec, rankColumn, RankCell } from '@/shared/ui/table'
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
  const update = useUpdateWorkItem(defect.id)

  function handleCommit(raw: string) {
    const next = raw.trim()
    if (!next || next === defect.title) return
    update.mutate({ title: next } as never, {
      onSuccess: () => {
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
        fullCell
        ariaLabel="Name"
        title={defect.title}
        className="block w-full text-ui-md break-words whitespace-normal text-foreground"
        inputClassName="text-foreground"
        inputStyle={{
          width: '100%',
          fontSize: 12,
          borderRadius: 2,
          outline: 'none',
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
  const update = useUpdateWorkItem(defect.id)

  function handleCommit(value: string) {
    const trimmed = value.trim()
    if (trimmed === (defect.fixedInBuild ?? '')) return
    update.mutate({ fixedInBuild: trimmed || null } as never, {
      onSuccess: () => {
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
        fullCell
        displayValue={defect.fixedInBuild ?? '--'}
        // `break-all`: a build identifier is user-typed and space-free.
        className="block w-full text-ui-xs break-all text-muted-foreground"
        inputClassName="text-foreground"
        inputStyle={{
          width: '100%',
          fontSize: 12,
          borderRadius: 2,
          outline: 'none',
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
  const update = useUpdateWorkItem(defect.id)
  // The REFERENCE feed (every state), not the timebox record: §5 gives an Editor
  // `Quality Defects View`, and `GET /iterations` is `timebox:view`. Every state, because the cell
  // must still render the label of a defect already sitting in an ACCEPTED iteration — narrowing to
  // the assignable population would blank the value the reader can see.
  const { data: iterations = [] } = useIterationOptions(projectId)

  if (!canEdit) {
    return (
      <span
        className="block break-words whitespace-normal text-muted-foreground"
        title={defect.iterationName ?? ''}
      >
        {defect.iterationName ?? '--'}
      </span>
    )
  }

  function handleChange(value: string) {
    const next = value || null
    if (next === (defect.iterationId ?? null)) return
    update.mutate({ iterationId: next } as never, {
      onSuccess: () => {
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
        placeholder="--"
        searchPlaceholder="Search"
        options={[
          { value: '', label: '--' },
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
  const update = useUpdateWorkItem(defect.id)
  // The ASSIGNEE feed, not the administrative roster (`GET /projects/:id/members`, Admin-only per
  // §3.1:71): this cell both NAMES and SETS the owner, and §3.2:79 gives an Editor the Defect. On
  // the roster a 403 defaulted to `[]`, which reads as a project with no one to assign to.
  const membersQuery = useProjectMemberOptions(projectId)
  const memberFeed = listResource(membersQuery)

  function handleChange(userId: string | null) {
    if (userId === (defect.assigneeId ?? null)) return
    update.mutate({ assigneeId: userId } as never, {
      onSuccess: () => {
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
        members={memberFeed.rows}
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
            onSuccess: () => {},
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
  // Rank as a real column, from the shared definition — it used to sit in the leading gutter with
  // a bespoke sort header, so it could not be resized, reordered or hidden.
  {
    // Rank draws through the engine like every other column, so the row body stays free of
    // per-column markup. The POSITION is per-render, not per-defect, so it rides on the ctx.
    ...rankColumn<DefectRow, QualityCtx>(),
    cell: (_row, ctx) => <RankCell rowNum={ctx.rowNum} />,
  },
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
    cellClassName: 'min-w-0 px-0',
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
        <span className="text-ui-sm text-foreground-faint">--</span>
      ),
  },
  {
    key: 'severity',
    label: 'Severity',
    sortCol: 'severity',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'px-0',
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
          <span className="text-ui-xs text-foreground-faint">--</span>
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
    cellClassName: 'px-0',
    cell: (d, ctx) => (
      <DefectInlineCell
        defect={d}
        field="priority"
        options={PRIORITY_OPTIONS}
        currentValue={d.priority}
        displayValue={
          d.priority === 'none' ? '--' : d.priority.charAt(0).toUpperCase() + d.priority.slice(1)
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
    cellClassName: 'flex items-center px-0',
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
    cellClassName: 'flex items-center px-0 select-none',
    cell: (d, ctx) => <FlowStateSelectCell defect={d} canEdit={ctx.canManage} />,
  },
  {
    key: 'fixedInBuild',
    label: 'Fixed In Build',
    sortCol: 'fixedInBuild',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'px-0',
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
    cellClassName: 'min-w-0 px-0',
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
    cellClassName: 'overflow-hidden px-0',
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
  const update = useUpdateWorkItem(defect.id)

  function handleChange(val: string) {
    if (val === currentValue) return
    update.mutate({ [field]: val || undefined } as never, {
      onSuccess: () => {},
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
  const [teamId, setTeamId] = useState('')
  const [teamError, setTeamError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Server/submit failures aren't tied to one input — shown as a modal-level
  // banner, not under the Title field.
  const [formError, setFormError] = useState<string | null>(null)

  // The ASSIGNEE feed, not the administrative roster — same reason as {@link OwnerInlineCell}:
  // logging a Defect is an Editor action (§3.2:79) and `GET /projects/:id/members` is Admin-only
  // (§3.1:71), so the Assignee picker in this modal 403'd and offered nobody but the empty option.
  const membersQuery = useProjectMemberOptions(projectId)
  const memberFeed = listResource(membersQuery)
  const { data: releases } = useReleases(projectId)
  const { data: stories = [] } = useStoryOptions(projectId)
  const createDefect = useCreateDefect()
  /**
   * A Defect is a Work Item, so the BA's 2026-08-17 Team rule applies to logging one.
   *
   * This form had no Team field at all, which made it an admin-only create by accident: every Editor
   * got `WORK_ITEM_TEAM_REQUIRED` (412) on a surface §5 gives them (`quality:view` is a
   * `PROJECT_MEMBER` code precisely so Quality is theirs). The field appears only when it is
   * REQUIRED — an admin's form keeps its documented shape, where an absent Team means the Project
   * Backlog.
   */
  const { teamRequired } = useProjectTeamScope(projectId)
  const { data: teams = [] } = useProjectTeams(projectId)
  // One Team is not a choice — see `CreateWorkItemModal`, which prefills for the same reason.
  const selectedTeamId = teamId || (teamRequired && teams.length === 1 ? teams[0].id : '')

  async function handleSubmit() {
    setError(null)
    setTeamError(null)
    setFormError(null)
    if (!title.trim()) {
      setError(t('create.titleRequired'))
      return
    }
    if (teamRequired && !selectedTeamId) {
      setTeamError(t('create.teamRequired'))
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
        teamId: selectedTeamId || undefined,
      })
      notify.success(t('create.logged', { name: title.trim() }))
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('create.logFailed')
      setFormError(msg)
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
          {formError && (
            <p role="alert" className="text-ui-sm text-destructive">
              {formError}
            </p>
          )}
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
                options={[{ value: '', label: '--' }, ...SEVERITY_OPTIONS]}
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
                  { value: '', label: '--' },
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
                  { value: '', label: '--' },
                  ...(
                    ['requirements', 'design', 'code', 'test', 'integration', 'other'] as const
                  ).map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })),
                ]}
                onChange={setRootCause}
              />
            </FormField>
          </div>
          {/* Team — rendered only for a caller who must choose one, and then with no empty option
              (BA ruling 2026-08-17). `TeamSelectField` marks it required from the same flag that
              withholds the blank, so the asterisk and the option list cannot disagree. */}
          {teamRequired && (
            <TeamSelectField
              label={t('create.teamLabel')}
              value={selectedTeamId}
              onChange={(v) => {
                setTeamId(v)
                setTeamError(null)
              }}
              teams={teams}
              allowUnassigned={false}
              error={teamError ?? undefined}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('create.assigneeLabel')}>
              <SearchableSelect
                variant="field"
                value={assigneeId}
                ariaLabel={t('create.assigneeLabel')}
                placeholder={t('create.unassigned')}
                options={ownerSelectOptions(memberFeed.rows, assigneeId)}
                onChange={setAssigneeId}
              />
            </FormField>
            <FormField label={t('create.releaseLabel')}>
              <SearchableSelect
                variant="field"
                value={releaseId}
                ariaLabel={t('create.releaseLabel')}
                options={[
                  { value: '', label: '--' },
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
            {createDefect.isPending && <Loader2 size={12} className="animate-spin" />}
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
    >
      <RowGutter
        ref={setActivatorNodeRef}
        dragListeners={listeners}
        dragAttributes={attributes}
        dragDisabled={dragDisabled}
        stopPropagation
        checkbox={{
          checked: selected,
          onChange: onToggleSelect,
          ariaLabel: `Select ${defect.itemKey}`,
        }}
      />
      {renderCells(defect, { canManage, projectId, openItem, rowNum })}
    </div>
  )
}

// ── Quality page ───────────────────────────────────────────────────────────
