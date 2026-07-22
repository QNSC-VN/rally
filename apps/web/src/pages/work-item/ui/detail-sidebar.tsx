import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { PanelRightClose } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import {
  useWorkItem,
  useWorkItemLabels,
  useWorkItemMilestones,
  useSetWorkItemMilestones,
  useTaskTotals,
  useBacklog,
  type WorkItem,
  type UpdateWorkItemInput,
} from '@/features/work-items/api'
import { useProjectTeams, useProjectMembers } from '@/features/teams/api'
import { useReleases } from '@/features/releases/api'
import { useMilestones } from '@/features/milestones/api'
import { useIterationOptions } from '@/features/iterations/api'
import { useSaveState } from '@/shared/lib/hooks/use-save-state'
import { deriveEstimateHours } from '@/entities/work-item/model/task-time'
import {
  PRIORITY_VALUES,
  ScheduleState,
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  TASK_STATE_VALUES,
  WORK_ITEM_PRIORITY_CONFIG,
  type WorkItemType,
} from '@/entities/work-item/model/types'
import { FormField } from '@/shared/ui/form-field'
import { NativeSelect } from '@/shared/ui/native-select'
import { OwnerSelectField, TeamSelectField } from '@/shared/ui/entity-select-field'
import { SelectionModal } from '@/shared/ui/selection-modal'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import { TaskRollup } from '@/entities/work-item/ui/task-rollup'
import { LabelChips } from '@/entities/work-item/ui/label-chips'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { SaveIndicator } from '@/shared/ui/save-indicator'
import { formatDate } from '@/shared/lib/utils'

type SaveStatus = ReturnType<typeof useSaveState>['status']

function ParentStorySelect({
  projectId,
  currentParentId,
  onUpdate,
}: {
  projectId: string
  currentParentId: string | null
  onUpdate: (patch: { parentId: string | null }) => void
}) {
  const { t } = useTranslation('work-items')
  const { data: backlogData } = useBacklog(projectId, { type: 'story' })
  const stories = backlogData?.data ?? []
  return (
    <NativeSelect
      value={currentParentId ?? ''}
      onChange={(e) => onUpdate({ parentId: e.target.value || null })}
    >
      <option value="">{t('sidebar.noParentStory')}</option>
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
        <span className="block rounded border border-input px-3 py-2 text-ui-md text-foreground-subtle">
          {emptyText}
        </span>
      )}
    </FormField>
  )
}

// ── Sidebar (Details tab) ─────────────────────────────────────────────────────

interface SidebarProps {
  item: WorkItem
  onUpdate: (patch: Partial<UpdateWorkItemInput>) => void
  updating: boolean
  readOnly: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  saveStatus?: SaveStatus
  saveErrorMsg?: string | null
}

export function DetailSidebar({
  item,
  onUpdate,
  updating,
  readOnly,
  collapsed = false,
  onToggleCollapse,
  saveStatus,
  saveErrorMsg,
}: SidebarProps) {
  const { t } = useTranslation('work-items')
  const { data: teams = [] } = useProjectTeams(item.projectId)
  const { data: members = [] } = useProjectMembers(item.projectId)
  const { data: releases = [] } = useReleases(item.projectId)
  const { data: iterations = [] } = useIterationOptions(item.projectId, item.teamId)
  const { data: parentItem } = useWorkItem(item.parentId ?? undefined)
  const { data: taskTotals } = useTaskTotals(item.type !== 'task' ? item.id : undefined)
  const { data: tags = [] } = useWorkItemLabels(item.id)
  const isTask = item.type === 'task'
  const isDefect = item.type === 'defect'
  const disabled = updating || readOnly
  const [showMilestones, setShowMilestones] = useState(false)
  // Milestones apply to Story/Defect only (Tasks inherit via their parent).
  const { data: milestoneOptions = [] } = useMilestones(!isTask ? item.projectId : undefined)
  const { data: itemMilestones = [] } = useWorkItemMilestones(!isTask ? item.id : undefined)
  const setMilestones = useSetWorkItemMilestones(item.id)
  // Reconciliation C01: with a Release selected, *new* add options are limited
  // to Milestones related to that Release — but an already-selected Milestone
  // must stay visible/intact even if it isn't related to the current Release,
  // so changing Release never silently drops an existing selection.
  const selectableMilestoneOptions = useMemo(() => {
    if (!item.releaseId) return milestoneOptions
    const selectedIds = new Set(itemMilestones.map((m) => m.id))
    return milestoneOptions.filter(
      (m) => selectedIds.has(m.id) || m.releaseIds.includes(item.releaseId!),
    )
  }, [milestoneOptions, itemMilestones, item.releaseId])
  const navigate = useNavigate()
  const openItem = (itemKey: string) => void navigate({ to: '/item/$itemKey', params: { itemKey } })

  const PRIORITIES = PRIORITY_VALUES.map((v) => ({
    value: v,
    label: WORK_ITEM_PRIORITY_CONFIG[v].label,
  }))

  // When collapsed, render nothing — the page-level "re-open" tab handles visibility
  if (collapsed) return null

  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-input bg-card">
      {/* Collapse toggle header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-avatar bg-card px-3 py-2">
        <span className="text-ui-sm font-semibold tracking-wide text-muted-foreground uppercase">
          {t('details.heading')}
        </span>
        <div className="flex items-center gap-2">
          {saveStatus && <SaveIndicator status={saveStatus} errorMsg={saveErrorMsg} />}
          <button
            onClick={onToggleCollapse}
            title="Hide sidebar"
            className="rounded p-1 transition-colors hover:bg-surface-subtle"
          >
            <PanelRightClose size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {isTask ? (
          /* Task State — a Task has ONE state dimension (BR-TASK-01). No
             Schedule/Flow split. The wire field is `scheduleState`; the backend
             mirrors it onto `task.state`. */
          <FormField label={t('sidebar.taskState')}>
            <NativeSelect
              value={item.scheduleState ?? ScheduleState.Defined}
              onChange={(e) =>
                onUpdate({ scheduleState: e.target.value as UpdateWorkItemInput['scheduleState'] })
              }
              disabled={disabled}
            >
              {TASK_STATE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_STATE_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : (
          <>
            {/* Schedule State — business-readiness dimension */}
            <FormField label={t('sidebar.scheduleState')}>
              <div>
                <StateStepper
                  steps={SCHEDULE_STATE_STEPS}
                  value={(item.scheduleState ?? ScheduleState.Defined) as ScheduleState}
                  canEdit={!disabled}
                  onChange={(next) => {
                    if (next !== item.scheduleState)
                      onUpdate({ scheduleState: next as UpdateWorkItemInput['scheduleState'] })
                  }}
                  ariaLabel="Schedule State"
                />
              </div>
            </FormField>

            {/* Flow State — mirrors Schedule State bidirectionally (backend
                enforces the mirror; either control updates both). */}
            <FormField label={t('sidebar.flowState')}>
              <NativeSelect
                value={item.flowState ?? item.scheduleState ?? ScheduleState.Defined}
                onChange={(e) =>
                  onUpdate({ flowState: e.target.value as UpdateWorkItemInput['flowState'] })
                }
                disabled={disabled}
              >
                {SCHEDULE_STATE_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {SCHEDULE_STATE_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </>
        )}

        {/* Owner */}
        <OwnerSelectField
          value={item.assigneeId}
          onChange={(v) => onUpdate({ assigneeId: v || null })}
          members={members}
          disabled={disabled}
        />

        {/* Team */}
        <TeamSelectField
          value={item.teamId}
          onChange={(v) => onUpdate({ teamId: v || null })}
          teams={teams}
          disabled={disabled}
        />

        {/* Priority — Defect only */}
        {item.type === 'defect' && (
          <FormField label={t('sidebar.priority')}>
            <NativeSelect
              value={item.priority ?? 'none'}
              onChange={(e) =>
                onUpdate({ priority: e.target.value as UpdateWorkItemInput['priority'] })
              }
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
          <FormField label={t('sidebar.environment')}>
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
              <option value="">{t('sidebar.env.notSpecified')}</option>
              <option value="development">{t('sidebar.env.development')}</option>
              <option value="staging">{t('sidebar.env.staging')}</option>
              <option value="production">{t('sidebar.env.production')}</option>
              <option value="testing">{t('sidebar.env.testing')}</option>
            </NativeSelect>
          </FormField>
        )}

        {/* Task: Work Product (parent link) */}
        {isTask && item.parentId && (
          <RelatedItemField
            label={t('sidebar.workProduct')}
            target={parentItem}
            emptyText={t('sidebar.loading')}
            onOpen={openItem}
          />
        )}

        {/* Story: Feature (parent link) */}
        {item.type === 'story' && item.parentId && (
          <RelatedItemField
            label={t('sidebar.feature')}
            target={parentItem}
            emptyText={t('sidebar.loading')}
            onOpen={openItem}
          />
        )}

        {/* Defect: Parent Story (editable dropdown, or read-only pill) */}
        {isDefect &&
          (disabled ? (
            <RelatedItemField
              label={t('sidebar.parentStory')}
              target={parentItem}
              emptyText={item.parentId ? t('sidebar.loading') : t('sidebar.noParentStory')}
              onOpen={openItem}
            />
          ) : (
            <FormField label={t('sidebar.parentStory')}>
              <ParentStorySelect
                projectId={item.projectId}
                currentParentId={item.parentId}
                onUpdate={(patch) => onUpdate(patch)}
              />
            </FormField>
          ))}

        {/* Task: time fields — Estimate is read-only derived (To Do + Actuals);
            To Do and Actuals are the manual inputs (SRS P1-TASK-01 / DEV-015). */}
        {isTask && (
          <>
            <FormField label={t('sidebar.estimateH')}>
              <div
                className="flex h-9 items-center rounded border border-input bg-input-background px-3 font-mono text-ui-lg text-foreground"
                title="Estimate is derived: To Do + Actuals"
                aria-readonly
              >
                {deriveEstimateHours(item.todoHours, item.actualHours)}h
              </div>
            </FormField>
            <FormField label={t('sidebar.todoH')}>
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
            <FormField label={t('sidebar.actualH')}>
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
          <FormField label={t('sidebar.planEstimatePts')}>
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
          <FormField label={t('sidebar.taskRollup')}>
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
            <FormField label={t('sidebar.iteration')}>
              <NativeSelect
                value={item.iterationId ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null
                  if (v !== (item.iterationId ?? null)) onUpdate({ iterationId: v })
                }}
                disabled={disabled}
              >
                <option value="">{t('sidebar.noIteration')}</option>
                {iterations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label={t('sidebar.release')}>
              <NativeSelect
                value={item.releaseId ?? ''}
                onChange={(e) => onUpdate({ releaseId: e.target.value || null })}
                disabled={disabled}
              >
                <option value="">{t('sidebar.noRelease')}</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            {/* Milestones — many-to-many, persisted independently of Release
                (SRS FR-022). Reuses the shared SelectionModal. */}
            <FormField label={t('sidebar.milestones')}>
              <button
                type="button"
                onClick={() => setShowMilestones(true)}
                disabled={disabled}
                className="flex w-full items-center justify-between rounded border border-input bg-card px-2 py-1 text-left text-ui-md"
                style={{
                  color: itemMilestones.length > 0 ? BRAND.textPrimary : BRAND.textMuted,
                  cursor: disabled ? 'default' : 'pointer',
                }}
                title={
                  itemMilestones.length > 0
                    ? itemMilestones.map((m) => m.name).join(', ')
                    : undefined
                }
              >
                <span className="truncate">
                  {itemMilestones.length > 0
                    ? itemMilestones.map((m) => m.name).join(', ')
                    : t('sidebar.noMilestones')}
                </span>
                {itemMilestones.length > 0 && (
                  <span className="ml-2 shrink-0 text-ui-sm text-foreground-subtle">
                    {itemMilestones.length}
                  </span>
                )}
              </button>
            </FormField>
          </>
        )}

        {/* Blocked flag */}
        {item.isBlocked && (
          <div className="flex items-start gap-2 rounded border border-destructive-border bg-destructive-bg p-2 text-ui-sm text-destructive">
            <span className="font-semibold">{t('sidebar.blockedLabel')}</span>
            <span>{item.blockedReason ?? t('sidebar.reasonNotProvided')}</span>
          </div>
        )}

        {/* Tags (labels) */}
        {tags.length > 0 && (
          <FormField label={t('sidebar.tags')}>
            <LabelChips labels={tags} />
          </FormField>
        )}

        {/* Creation Date (read-only) */}
        <FormField label={t('sidebar.creationDate')}>
          <span className="block px-1 text-ui-md text-muted-foreground">
            {formatDate(item.createdAt)}
          </span>
        </FormField>

        {/* Read-only notice */}
        {readOnly && (
          <div className="rounded border border-avatar bg-surface-hover px-3 py-2 text-ui-xs text-muted-foreground">
            {t('sidebar.readOnlyNotice')}
          </div>
        )}
      </div>
      {/* end p-5 space-y-4 */}
      {showMilestones && (
        <SelectionModal
          open={showMilestones}
          onClose={() => setShowMilestones(false)}
          title={t('sidebar.milestones')}
          items={selectableMilestoneOptions.map((m) => ({ id: m.id, name: m.name }))}
          selectedIds={itemMilestones.map((m) => m.id)}
          onSave={(ids) => setMilestones.mutateAsync(ids).then(() => undefined)}
        />
      )}
    </aside>
  )
}
