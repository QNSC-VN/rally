import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { BRAND } from '@/shared/config/brand'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { notify } from '@/shared/lib/toast'
import {
  useUpdateWorkItem,
  useSetWorkItemMilestones,
  useTasks,
  type WorkItem,
} from '@/features/work-items/api'
import { type IterationStatusItem } from '@/features/iterations/api'
import {
  type ScheduleState,
  getSimplifiedState,
  SIMPLIFIED_STATE_TO_SCHEDULE_STATE,
} from '@/entities/work-item/model/types'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { FeatureCell } from '@/entities/work-item/ui/feature-cell'
import { SCHEDULE_STATE_STEPS, SIMPLIFIED_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { OwnerSelectCell } from '@/shared/ui/owner-cell'
import { RowGutter } from '@/shared/ui/row-gutter'
import { MilestoneSelectCell, DefectStatusPill, TasksProgress } from './status-cells'
import { useWorkItemFieldCommit } from '../model/use-work-item-field-commit'

// Single mono stack for numeric cells (digit alignment).
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

// ── Status row ──────────────────────────────────────────────────────────────

export function StatusRow({
  item,
  rank,
  memberMap,
  milestoneOptions,
  iterationOptions,
  selectedIterationId,
  canEdit,
  colStyles,
  dragEnabled,
  selected,
  onToggleSelect,
  onOpen,
}: {
  item: IterationStatusItem
  rank: number
  memberMap: Map<string, import('@/features/teams/api').ProjectMember>
  milestoneOptions: readonly { id: string; name: string; milestoneKey?: string | null }[]
  iterationOptions: readonly { id: string; name: string; iterationKey?: string | null }[]
  selectedIterationId: string
  canEdit: boolean
  colStyles: Record<string, CSSProperties>
  dragEnabled: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation('iteration-status')
  const navigate = useNavigate()
  const update = useUpdateWorkItem(item.id)
  const setMilestones = useSetWorkItemMilestones(item.id)
  const member = item.assigneeId ? memberMap.get(item.assigneeId) : undefined
  const ownerName = member?.displayName ?? member?.email ?? null
  const devOwner = item.devOwnerId ? memberMap.get(item.devOwnerId) : undefined
  const devOwnerName = devOwner?.displayName ?? devOwner?.email ?? null

  // Narrowed locals so closures below keep the non-null type.
  const featureKey = item.featureKey
  const featureTitle = item.featureTitle
  const milestones = item.milestones

  const [tasksExpanded, setTasksExpanded] = useState(false)
  const { data: childTasks = [], isLoading: isLoadingTasks } = useTasks(
    tasksExpanded ? item.id : undefined,
  )

  const membersList = useMemo(() => Array.from(memberMap.values()), [memberMap])

  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: !dragEnabled || !canEdit,
  })
  const rowStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const { save, saveNumber } = useWorkItemFieldCommit(update)
  const milestoneCommit = useWorkItemFieldCommit(setMilestones)

  const commitEstimate = (raw: string) =>
    // Auto-sync To Do to the new Plan Estimate value.
    saveNumber(
      raw,
      (n) => ({ storyPoints: n, todoHours: n }),
      t('row.planEstimateUpdated'),
      'Estimate',
    )
  const commitTodo = (raw: string) =>
    saveNumber(raw, (n) => ({ todoHours: n }), t('row.todoHoursUpdated'), 'Todo hours')
  const commitTitle = (raw: string) => {
    const next = raw.trim()
    if (!next || next === item.title) return
    save({ title: next }, t('row.nameUpdated'))
  }
  const handleOwnerChange = (userId: string | null) =>
    save({ assigneeId: userId }, t('row.ownerUpdated'))
  const handleIterationChange = (iterationId: string | null) =>
    save({ iterationId }, iterationId ? t('row.iterationUpdated') : t('row.movedToBacklog'))
  const handleDevOwnerChange = (userId: string | null) =>
    save({ devOwnerId: userId }, t('row.devOwnerUpdated'))
  const handleMilestonesChange = (ids: string[]) =>
    milestoneCommit.save(ids, t('row.milestonesUpdated'))
  const commitBlockedReason = (raw: string) => {
    const next = raw.trim()
    if (next === (item.blockedReason ?? '')) return
    save({ blockedReason: next || null }, t('row.blockedReasonUpdated'))
  }
  const toggleBlocked = () =>
    save({ isBlocked: !item.isBlocked }, item.isBlocked ? t('row.unblocked') : t('row.blocked'))

  return (
    <>
      <div
        ref={setNodeRef}
        className="group flex items-center border-b border-border-subtle bg-card transition-colors duration-100 hover:bg-primary-lighter"
        style={{
          minHeight: 34,
          paddingLeft: 4,
          paddingRight: 12,
          fontSize: 12,
          minWidth: 'max-content',
          ...rowStyle,
        }}
        {...(dragEnabled && canEdit ? attributes : {})}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = BRAND.primaryLighter
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = BRAND.surface
        }}
      >
        {/* Leading gutter (rank grip + selection checkbox) — shared component so
            the header, rows and nested child rows stay column-aligned. */}
        <RowGutter
          ref={setActivatorNodeRef}
          dragDisabled={!dragEnabled || !canEdit}
          dragListeners={dragEnabled && canEdit ? listeners : undefined}
          stopPropagation
          checkbox={{
            checked: selected,
            onChange: onToggleSelect,
            ariaLabel: `Select ${item.itemKey}`,
          }}
        />

        {/* Rank number */}
        <div style={colStyles.rank} className="flex items-center justify-center px-2">
          <span className="font-mono text-ui-xs text-muted-foreground tabular-nums">{rank}</span>
        </div>

        {/* ID — expand/collapse toggle lives here (Rally parity), to the left of
            the item type icon + key. */}
        <div style={colStyles.id} className="flex items-center gap-1.5 px-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setTasksExpanded(!tasksExpanded)
            }}
            aria-label={tasksExpanded ? 'Collapse tasks' : 'Expand tasks'}
            className="text-muted-foreground"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <ChevronDown
              size={12}
              style={{
                transform: tasksExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.15s ease',
              }}
            />
          </button>
          <IdCell type={item.type} itemKey={item.itemKey} onOpen={onOpen} />
        </div>

        {/* Name — click to edit inline (Rally parity); use the ID link to open */}
        <div
          style={colStyles.name}
          className="overflow-hidden px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditableCell
            value={item.title}
            canEdit={canEdit}
            onCommit={commitTitle}
            ariaLabel="Name"
            title={item.title}
            className="block w-full break-words whitespace-normal text-foreground"
            style={{ fontSize: 12 }}
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

        {/* Feature */}
        <div style={colStyles.feature} className="flex items-center overflow-hidden px-2">
          {featureKey ? (
            <FeatureCell
              featureKey={featureKey}
              featureTitle={featureTitle}
              onOpen={() => navigate({ to: '/item/$itemKey', params: { itemKey: featureKey } })}
            />
          ) : (
            <span className="text-foreground-subtle" style={{ fontSize: 12 }}>
              &mdash;
            </span>
          )}
        </div>

        {/* Iteration — inline reassign (move item to another iteration or backlog) */}
        <div
          style={colStyles.iteration}
          className="flex items-center overflow-hidden px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <SearchableSelect
            value={item.iterationId ?? ''}
            readOnly={!canEdit}
            ariaLabel="Iteration"
            placeholder={t('row.backlog')}
            options={[
              { value: '', label: t('row.backlog') },
              ...iterationOptions.map((it) => ({
                value: it.id,
                label: it.iterationKey ? `${it.iterationKey}: ${it.name}` : it.name,
                searchText: `${it.iterationKey ?? ''} ${it.name}`,
                icon: <TypeBadge type="iteration" size={16} />,
              })),
            ]}
            onChange={(v) => handleIterationChange(v || null)}
          />
        </div>

        {/* Schedule State — Rally-style segmented stepper */}
        <div
          style={colStyles.state}
          className="flex items-center px-2 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <ScheduleStateStepper
            value={item.scheduleState as ScheduleState}
            canEdit={canEdit}
            onChange={(next) => update.mutate({ scheduleState: next })}
          />
        </div>

        {/* Block - Click to Toggle */}
        <div style={colStyles.block} className="flex justify-center px-2">
          <button
            onClick={canEdit ? toggleBlocked : undefined}
            style={{
              background: 'none',
              border: 'none',
              cursor: canEdit ? 'pointer' : 'default',
              padding: 0,
            }}
          >
            {item.isBlocked ? (
              <span
                className="border border-destructive-border bg-destructive-bg text-destructive"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 20,
                  borderRadius: 2,
                  fontSize: 11,
                  fontWeight: 700,
                }}
                title="Blocked - Click to Unblock"
              >
                B
              </span>
            ) : (
              <span
                className="border border-dashed border-border-strong text-foreground-subtle"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 20,
                  borderRadius: 2,
                  fontSize: 11,
                  fontWeight: 500,
                }}
                title="Unblocked - Click to Block"
              >
                &middot;
              </span>
            )}
          </button>
        </div>

        {/* Blocked Reason — inline-editable only while the item is blocked
            (an unblocked item has no reason to capture). */}
        <div style={colStyles.blockedReason} className="flex items-center px-2">
          {canEdit && item.isBlocked ? (
            <InlineEditableCell
              value={item.blockedReason ?? ''}
              canEdit={canEdit}
              onCommit={commitBlockedReason}
              ariaLabel="Blocked reason"
              title={item.blockedReason ?? 'Add a blocked reason'}
              className="w-full text-muted-foreground"
              style={{ fontSize: 12 }}
              displayValue={
                item.blockedReason ? (
                  <span className="block truncate text-muted-foreground">{item.blockedReason}</span>
                ) : (
                  <span className="block truncate text-foreground-subtle italic">Add reason…</span>
                )
              }
              inputClassName="border border-primary"
              inputStyle={{ width: '100%', fontSize: 11, borderRadius: 2, outline: 'none' }}
            />
          ) : item.blockedReason ? (
            <span
              className="truncate text-muted-foreground"
              title={item.blockedReason}
              style={{ fontSize: 12 }}
            >
              {item.blockedReason}
            </span>
          ) : (
            <span className="text-foreground-subtle" style={{ fontSize: 12 }}>
              &mdash;
            </span>
          )}
        </div>

        {/* Plan Estimate */}
        <div style={{ ...colStyles.planEstimate, textAlign: 'right' }} className="px-2">
          <InlineEditableCell
            value={String(item.planEstimate ?? '')}
            canEdit={canEdit}
            onCommit={commitEstimate}
            displayValue={item.planEstimate ?? '—'}
            className="text-muted-foreground"
            style={{
              fontFamily: MONO_FONT,
              fontSize: 12,
            }}
            inputClassName="border border-primary"
            inputStyle={{
              width: '100%',
              textAlign: 'right',
              fontSize: 11,
              fontFamily: MONO_FONT,
              borderRadius: 2,
              outline: 'none',
            }}
            ariaLabel="Plan estimate"
          />
        </div>

        {/* Task Estimate (Rollup - readonly) */}
        <div
          style={{
            ...colStyles.taskEstimate,
            textAlign: 'right',
            fontFamily: MONO_FONT,
            fontSize: 12,
          }}
          className="px-2 text-right text-muted-foreground"
        >
          {item.taskEstimate || '—'}
        </div>

        {/* To Do */}
        <div style={{ ...colStyles.toDo, textAlign: 'right' }} className="px-2">
          <InlineEditableCell
            value={String(item.toDo ?? '')}
            canEdit={canEdit}
            onCommit={commitTodo}
            displayValue={item.toDo ?? '—'}
            className="text-muted-foreground"
            style={{
              fontFamily: MONO_FONT,
              fontSize: 12,
            }}
            inputClassName="border border-primary"
            inputStyle={{
              width: '100%',
              textAlign: 'right',
              fontSize: 11,
              fontFamily: MONO_FONT,
              borderRadius: 2,
              outline: 'none',
            }}
            ariaLabel="Todo hours"
          />
        </div>

        {/* Tasks % complete (rollup) */}
        <div style={colStyles.tasksPct} className="flex items-center px-2">
          <TasksProgress total={item.taskTotal} done={item.taskDone} />
        </div>

        {/* Actual — read-only roll-up of child task actual hours (parity with
            Task Est / To Do). Edited per-task on the expanded task rows. */}
        <div
          style={{ ...colStyles.actual, textAlign: 'right', fontFamily: MONO_FONT, fontSize: 12 }}
          className="px-2 text-right text-muted-foreground"
        >
          {item.actual || '—'}
        </div>

        {/* Owner */}
        <div
          style={colStyles.owner}
          className="overflow-hidden px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <OwnerSelectCell
            ownerName={ownerName}
            assigneeId={item.assigneeId}
            members={membersList}
            canEdit={canEdit}
            onChange={handleOwnerChange}
          />
        </div>

        {/* Defects — child-defect count */}
        <div
          style={{ ...colStyles.defects, textAlign: 'center', fontSize: 12 }}
          className="px-2 text-center"
        >
          {item.defectCount > 0 ? (
            <span className="text-muted-foreground" style={{ fontWeight: 600 }}>
              {item.defectCount}
            </span>
          ) : (
            <span className="text-foreground-subtle">&mdash;</span>
          )}
        </div>

        {/* Defect Status — open/closed summary */}
        <div style={colStyles.defectStatus} className="flex items-center px-2">
          <DefectStatusPill total={item.defectCount} open={item.openDefectCount} />
        </div>

        {/* Milestones — inline multi-select (add/remove) */}
        <div
          style={colStyles.milestones}
          className="flex items-center overflow-hidden px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <MilestoneSelectCell
            selected={milestones}
            options={milestoneOptions}
            canEdit={canEdit}
            saving={setMilestones.isPending}
            onCommit={handleMilestonesChange}
          />
        </div>

        {/* Dev Owner — editable assignee (distinct from Owner) */}
        <div
          style={colStyles.devOwner}
          className="overflow-hidden px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <OwnerSelectCell
            ownerName={devOwnerName}
            assigneeId={item.devOwnerId}
            members={membersList}
            canEdit={canEdit}
            onChange={handleDevOwnerChange}
            ariaLabel="Dev owner"
          />
        </div>

        {/* selectedIterationId kept for future refetch semantics */}
        <span hidden>{selectedIterationId}</span>
      </div>

      {/* Child Tasks List — the 2px hierarchy rail is an inset shadow (not a
          border) so it never shifts the child columns out of alignment with
          the parent row / header. */}
      {tasksExpanded && (
        <div
          className="bg-surface-hover"
          style={{
            boxShadow: `inset 2px 0 0 ${BRAND.primaryLighter}`,
          }}
        >
          {isLoadingTasks && (
            <div
              className="text-foreground-subtle"
              style={{
                padding: '6px 44px',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Loader2 size={12} className="animate-spin" /> {t('row.loadingTasks')}
            </div>
          )}
          {!isLoadingTasks && childTasks.length === 0 && (
            <div
              className="text-foreground-subtle"
              style={{
                padding: '6px 44px',
                fontSize: 11,
                fontStyle: 'italic',
              }}
            >
              {t('row.noTasks')}
            </div>
          )}
          {!isLoadingTasks &&
            childTasks.map((task) => {
              const taskMember = task.assigneeId ? memberMap.get(task.assigneeId) : undefined
              const taskOwner = taskMember?.displayName ?? taskMember?.email ?? 'Unassigned'
              return (
                <ChildTaskRow
                  key={task.id}
                  task={task}
                  taskOwner={taskOwner}
                  membersList={membersList}
                  canEdit={canEdit}
                  colStyles={colStyles}
                  onOpen={() =>
                    navigate({ to: '/item/$itemKey', params: { itemKey: task.itemKey } })
                  }
                />
              )
            })}
        </div>
      )}
    </>
  )
}

// ── Child task row ──────────────────────────────────────────────────────────

function ChildTaskRow({
  task,
  taskOwner,
  membersList,
  canEdit,
  colStyles,
  onOpen,
}: {
  task: WorkItem
  taskOwner: string
  membersList: import('@/features/teams/api').ProjectMember[]
  canEdit: boolean
  colStyles: Record<string, CSSProperties>
  onOpen: () => void
}) {
  const { t } = useTranslation('iteration-status')
  const updateTask = useUpdateWorkItem(task.id)

  const { save, saveNumber } = useWorkItemFieldCommit(updateTask)

  const commitTaskTitle = (raw: string) => {
    const next = raw.trim()
    if (!next || next === task.title) return
    save({ title: next }, t('row.nameUpdated'))
  }
  // Auto-sync To Do to the new estimate value.
  const commitTaskEstimate = (raw: string) =>
    saveNumber(
      raw,
      (n) => ({ estimateHours: n, todoHours: n }),
      t('row.taskEstimateUpdated'),
      'Estimate',
    )
  const commitTaskTodo = (raw: string) =>
    saveNumber(raw, (n) => ({ todoHours: n }), t('row.todoHoursUpdated'), 'Todo hours')
  const commitTaskActual = (raw: string) =>
    saveNumber(raw, (n) => ({ actualHours: n }), t('row.actualHoursUpdated'), 'Actual hours')
  const handleOwnerChange = (userId: string | null) =>
    save({ assigneeId: userId }, t('row.ownerUpdated'))
  const handleDevOwnerChange = (userId: string | null) =>
    save({ devOwnerId: userId }, t('row.devOwnerUpdated'))

  const devOwnerMember = task.devOwnerId
    ? membersList.find((m) => m.userId === task.devOwnerId)
    : undefined
  const taskDevOwnerName = devOwnerMember?.displayName ?? devOwnerMember?.email ?? null

  return (
    <div
      className="flex items-center border-b border-dashed border-border-subtle text-muted-foreground"
      style={{
        minHeight: 30,
        paddingLeft: 4,
        paddingRight: 12,
        fontSize: 11,
        minWidth: 'max-content',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.backgroundColor = BRAND.primaryLighter
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {/* Leading gutter mirrors the parent row exactly (grip · checkbox · rank)
          via the shared component, so every child cell lines up under the same
          column. */}
      <RowGutter dragDisabled />
      <div style={colStyles.rank} className="px-2" />
      {/* ID nested under the parent via the shared indent token. */}
      <div style={colStyles.id} className={`pr-2 ${NESTED_ROW_INDENT}`}>
        <IdCell type={task.type} itemKey={task.itemKey} onOpen={onOpen} />
      </div>
      <div
        style={colStyles.name}
        className="overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          value={task.title}
          canEdit={canEdit}
          onCommit={commitTaskTitle}
          ariaLabel="Name"
          title={task.title}
          className="block w-full break-words whitespace-normal text-foreground"
          style={{ fontSize: 12 }}
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
      <div style={colStyles.feature} className="px-2" />
      <div style={colStyles.iteration} className="px-2" />
      <div
        style={colStyles.state}
        className="flex items-center px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <SimplifiedStateControl
          scheduleState={task.scheduleState as ScheduleState}
          canEdit={canEdit}
          onChange={(next) => {
            updateTask.mutate(
              { scheduleState: next },
              {
                onSuccess: () => notify.success(t('row.taskStateUpdated')),
                onError: (err) => notify.error(err.message),
              },
            )
          }}
        />
      </div>
      <div style={colStyles.block} className="px-2" />
      <div style={colStyles.blockedReason} className="px-2" />
      <div style={colStyles.planEstimate} className="px-2" />
      <div style={{ ...colStyles.taskEstimate, textAlign: 'right' }} className="px-2 text-right">
        <InlineEditableCell
          value={String(task.estimateHours ?? '')}
          canEdit={canEdit}
          onCommit={commitTaskEstimate}
          displayValue={task.estimateHours ?? '—'}
          style={{ fontFamily: MONO_FONT, fontSize: 11 }}
          inputClassName="border border-primary"
          inputStyle={{
            width: '100%',
            textAlign: 'right',
            fontSize: 11,
            fontFamily: MONO_FONT,
            borderRadius: 2,
            outline: 'none',
          }}
          ariaLabel="Task estimate"
        />
      </div>
      <div style={{ ...colStyles.toDo, textAlign: 'right' }} className="px-2 text-right">
        <InlineEditableCell
          value={String(task.todoHours ?? '')}
          canEdit={canEdit}
          onCommit={commitTaskTodo}
          displayValue={task.todoHours ?? '—'}
          style={{ fontFamily: MONO_FONT, fontSize: 11 }}
          inputClassName="border border-primary"
          inputStyle={{
            width: '100%',
            textAlign: 'right',
            fontSize: 11,
            fontFamily: MONO_FONT,
            borderRadius: 2,
            outline: 'none',
          }}
          ariaLabel="Todo hours"
        />
      </div>
      <div style={colStyles.tasksPct} className="px-2" />
      <div style={{ ...colStyles.actual, textAlign: 'right' }} className="px-2 text-right">
        <InlineEditableCell
          value={String(task.actualHours ?? '')}
          canEdit={canEdit}
          onCommit={commitTaskActual}
          displayValue={task.actualHours ?? '—'}
          style={{ fontFamily: MONO_FONT, fontSize: 11 }}
          inputClassName="border border-primary"
          inputStyle={{
            width: '100%',
            textAlign: 'right',
            fontSize: 11,
            fontFamily: MONO_FONT,
            borderRadius: 2,
            outline: 'none',
          }}
          ariaLabel="Actual hours"
        />
      </div>
      <div
        style={colStyles.owner}
        className="overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerSelectCell
          ownerName={task.assigneeId ? taskOwner : null}
          assigneeId={task.assigneeId}
          members={membersList}
          canEdit={canEdit}
          onChange={handleOwnerChange}
        />
      </div>
      <div style={colStyles.defects} className="px-2" />
      <div style={colStyles.defectStatus} className="px-2" />
      <div style={colStyles.milestones} className="px-2" />
      <div
        style={colStyles.devOwner}
        className="overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerSelectCell
          ownerName={taskDevOwnerName}
          assigneeId={task.devOwnerId}
          members={membersList}
          canEdit={canEdit}
          onChange={handleDevOwnerChange}
          ariaLabel="Dev owner"
        />
      </div>
    </div>
  )
}

// ── Segmented state stepper (Rally parity) ──────────────────────────────────
// Both wrappers delegate to the shared StateStepper so every grid row —
// story/defect and task — uses one visual language (see state-stepper.tsx).

// Story-level schedule-state stepper (7 states).
function ScheduleStateStepper({
  value,
  canEdit,
  onChange,
}: {
  value: ScheduleState
  canEdit: boolean
  onChange: (next: ScheduleState) => void
}) {
  return (
    <StateStepper
      steps={SCHEDULE_STATE_STEPS}
      value={value}
      canEdit={canEdit}
      onChange={onChange}
      ariaLabel="Schedule state"
    />
  )
}

// Task-level simplified-state stepper (Define / In-Progress / Complete).
function SimplifiedStateControl({
  scheduleState,
  canEdit,
  onChange,
}: {
  scheduleState: ScheduleState
  canEdit: boolean
  onChange: (next: ScheduleState) => void
}) {
  const current = SIMPLIFIED_STATE_TO_SCHEDULE_STATE[getSimplifiedState(scheduleState)]
  return (
    <StateStepper
      steps={SIMPLIFIED_STATE_STEPS}
      value={current}
      canEdit={canEdit}
      onChange={onChange}
      ariaLabel="Task state"
    />
  )
}
