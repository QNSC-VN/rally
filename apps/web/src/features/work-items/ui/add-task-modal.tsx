/**
 * AddTaskModal — creates a child task under a work item.
 * P1-TASK-CREATE per SRS §04_Task_Management.
 */
import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCreateTask } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { OwnerSelectField } from '@/shared/ui/entity-select-field'

interface Props {
  workItemId: string
  onClose: () => void
}

export function AddTaskModal({ workItemId, onClose }: Props) {
  const { project } = useAppContext()
  const { data: members = [] } = useProjectMembers(project?.projectId)
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [estimate, setEstimate] = useState('')
  const [todo, setTodo] = useState('')
  const [actual, setActual] = useState('')
  // Owner defaults to the authenticated creator (still changeable, incl. Unassigned).
  const currentUserId = useAuthStore((s) => s.user?.id)
  const [assigneeId, setAssigneeId] = useState(() => currentUserId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createTask = useCreateTask(workItemId)
  const nameRef = useRef<HTMLInputElement>(null)

  async function submit(withDetails: boolean) {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
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
      setError(e instanceof Error ? e.message : 'Failed to create task.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title="Create Task"
      subtitle="Create a child task under this work item."
      width={520}
    >
      <ModalBody className="space-y-4">
        <FormField label="Name" htmlFor="task-name" required error={error ?? undefined}>
          <Input
            id="task-name"
            ref={nameRef}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter task name"
          />
        </FormField>

        <div className="grid grid-cols-3 gap-4">
          <FormField label="Estimate (hrs)" htmlFor="task-estimate">
            <Input
              id="task-estimate"
              type="number"
              min={0}
              step={0.5}
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="0"
            />
          </FormField>

          <FormField label="To Do (hrs)" htmlFor="task-todo">
            <Input
              id="task-todo"
              type="number"
              min={0}
              step={0.5}
              value={todo}
              onChange={(e) => setTodo(e.target.value)}
              placeholder="= Estimate"
            />
          </FormField>

          <FormField label="Actuals (hrs)" htmlFor="task-actual">
            <Input
              id="task-actual"
              type="number"
              min={0}
              step={0.5}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder="0"
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
          Cancel
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => void submit(true)}
            disabled={submitting || !name.trim()}
          >
            Create with details
          </Button>
          <Button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting || !name.trim()}
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {submitting ? 'Creating…' : 'Create Task'}
          </Button>
        </div>
      </ModalFooter>
    </AppModal>
  )
}
