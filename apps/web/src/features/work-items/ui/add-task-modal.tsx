/**
 * AddTaskModal — creates a child task under a work item.
 * P1-TASK-CREATE per SRS §04_Task_Management.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCreateTask, useWorkItem } from '@/features/work-items/api'
import { useTeamOwnerOptions } from '@/features/teams/api'
import { useRecordProject } from '@/shared/lib/deep-link-project'
import { useDefaultOwner } from '@/shared/lib/hooks/use-default-owner'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField, ReadOnlyFieldValue } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { OwnerSelectField } from '@/shared/ui/entity-select-field'
import { ProjectCell } from '@/shared/ui/project-cell'

interface Props {
  workItemId: string
  onClose: () => void
}

export function AddTaskModal({ workItemId, onClose }: Props) {
  const { t } = useTranslation('work-items')
  /**
   * The PARENT, not the app shell's selected project (P6-E2E-003).
   *
   * A task created under a known `workItemId` inherits that parent's project AND team
   * (`WorkItemsService.createTask`: `teamId: opts.teamId ?? parent.teamId`), so both facts are
   * properties of the parent. Reading the owner feed from `useAppContext().project` meant that opening
   * this modal from a deep-linked item — before the shell had adopted its project, or on a row whose
   * project is simply not the selected one — offered another project's members for a task the server
   * would then file under this one.
   */
  const { data: parent } = useWorkItem(workItemId)
  /**
   * Owner OPTIONS are the parent's TEAM's active members, or nothing at all (GAP-P1-WID-007:
   * "Selected Team offers Unassigned plus its ACTIVE MEMBERS; No Team offers only Unassigned").
   * No merge of an existing owner is needed here — a task being created has none.
   */
  const { data: members = [] } = useTeamOwnerOptions(parent?.projectId, parent?.teamId)
  /**
   * The PARENT's project, shown read-only (Task Management AC #14: "a Task's Project always
   * equals its parent's, read-only").
   *
   * Displayed rather than merely implied: the modal sends no `projectId` at all — `createTask`
   * derives it from `workItemId` — but a create form that shows Owner and three hour fields and
   * says nothing about Project leaves the reader to assume it landed in whatever the global
   * selector names, which for a deep-linked item need not be the parent's project. This is a
   * DISPLAY of a derived fact, so there is no field, no option list and no handler.
   */
  const projectDisplay = useRecordProject(parent?.projectId)
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [estimate, setEstimate] = useState('')
  const [todo, setTodo] = useState('')
  const [actual, setActual] = useState('')
  /**
   * Owner defaults to the current user WHEN THIS TASK'S OWN FEED OFFERS THEM, else `Unassigned`
   * (`WIC-FR-006`, BA `c42df59`, 2026-08-22).
   *
   * This field held the opposite rule until now, and the history is the reason the gate matters.
   * `GAP-P1-WID-007` / `P6-TC-007` reported a "null-owner Task attributed to a named member", and
   * `GAP-P3-TS-008` an outside-team member group in Team Status; the cause of both was this modal
   * seeding the authenticated creator's id UNCONDITIONALLY, so a task created "without an owner"
   * silently arrived owned by whoever happened to open the form — a person who need not be on the
   * team the task's hours are counted under. The fix at the time was to default to nothing.
   *
   * The BA has since reversed the default itself, and `useDefaultOwner` gates it on the candidate
   * feed, which is what makes the reversal safe rather than a return to the defect: the creator is
   * offered only where the shared assignment rule already offers them, so a person outside the
   * parent's team is still never defaulted in. `members` here is the PARENT's team feed
   * (`TASK-FR-017` scopes a Task's options to the inherited parent Team), so the gate is asking
   * about the right population.
   *
   * `rollUpTeamCapacity` still keys `ownerId ?? 'Unassigned'`, and `Unassigned` is still reachable —
   * the reader can choose it, and it survives being chosen.
   */
  const { ownerId: assigneeId, setOwnerId: setAssigneeId } = useDefaultOwner(members)
  const [error, setError] = useState<string | null>(null)
  // Server/submit failures aren't tied to one input — shown as a modal-level
  // banner, not under the Name field.
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createTask = useCreateTask(workItemId)
  const nameRef = useRef<HTMLInputElement>(null)

  async function submit(withDetails: boolean) {
    if (!name.trim()) {
      setError(t('tasks.create.nameRequired'))
      return
    }
    setError(null)
    setFormError(null)
    setSubmitting(true)
    try {
      const task = await createTask.mutateAsync({
        title: name.trim(),
        estimateHours: estimate ? Number(estimate) : undefined,
        todoHours: todo ? Number(todo) : undefined,
        actualHours: actual ? Number(actual) : undefined,
        assigneeId: assigneeId || undefined,
      })
      onClose()
      if (withDetails) {
        void navigate({ to: '/item/$itemKey', params: { itemKey: task.itemKey } })
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('tasks.create.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('tasks.create.title')}
      subtitle={t('tasks.create.subtitle')}
      width={520}
    >
      <ModalBody className="space-y-4">
        {formError && (
          <p role="alert" className="text-ui-sm text-destructive">
            {formError}
          </p>
        )}
        <FormField
          label={t('tasks.create.nameLabel')}
          htmlFor="task-name"
          required
          error={error ?? undefined}
        >
          <Input
            id="task-name"
            ref={nameRef}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('tasks.create.namePlaceholder')}
          />
        </FormField>

        {/* Project — inherited from the parent Work Item and read-only (Task Management AC #14).
            Same shared `ProjectCell` glyph the Tasks tab and the detail sidebar render. */}
        <FormField label={t('create.projectLabel')}>
          <ReadOnlyFieldValue>
            <ProjectCell
              projectKey={projectDisplay?.projectKey}
              projectName={projectDisplay?.projectName}
            />
          </ReadOnlyFieldValue>
        </FormField>

        <div className="grid grid-cols-3 gap-4">
          <FormField label={t('tasks.create.estimateLabel')} htmlFor="task-estimate">
            <Input
              id="task-estimate"
              type="number"
              min={0}
              step={0.5}
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder={t('tasks.create.estimatePlaceholder')}
            />
          </FormField>

          <FormField label={t('tasks.create.todoLabel')} htmlFor="task-todo">
            <Input
              id="task-todo"
              type="number"
              min={0}
              step={0.5}
              value={todo}
              onChange={(e) => setTodo(e.target.value)}
              placeholder={t('tasks.create.todoPlaceholder')}
            />
          </FormField>

          <FormField label={t('tasks.create.actualLabel')} htmlFor="task-actual">
            <Input
              id="task-actual"
              type="number"
              min={0}
              step={0.5}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder={t('tasks.create.actualPlaceholder')}
            />
          </FormField>
        </div>

        <OwnerSelectField
          id="task-owner"
          value={assigneeId}
          onChange={setAssigneeId}
          members={members}
        />
      </ModalBody>

      <ModalFooter className="justify-between">
        <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
          {t('common:cancel')}
        </Button>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={() => void submit(true)}
            disabled={submitting || !name.trim()}
          >
            {t('tasks.create.createWithDetails')}
          </Button>
          <Button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting || !name.trim()}
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {submitting ? t('tasks.create.creating') : t('tasks.create.createButton')}
          </Button>
        </div>
      </ModalFooter>
    </AppModal>
  )
}
