/**
 * AddTaskModal — creates a child task under a work item.
 * P1-TASK-CREATE per SRS §04_Task_Management.
 */
import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateTask } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { deriveEstimateHours } from '@/entities/work-item/model/task-time'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { BRAND } from '@/shared/config/brand'

interface Props {
  workItemId: string
  onClose: () => void
}

export function AddTaskModal({ workItemId, onClose }: Props) {
  const { project } = useAppContext()
  const { data: members = [] } = useProjectMembers(project?.projectId)

  const [name, setName] = useState('')
  const [todo, setTodo] = useState('')
  const [actual, setActual] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createTask = useCreateTask(workItemId)
  const nameRef = useRef<HTMLInputElement>(null)

  // Estimate is read-only derived (Estimate = To Do + Actuals); the backend
  // recomputes and stores it, so we only submit the two manual inputs.
  const estimate = deriveEstimateHours(todo, actual)

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await createTask.mutateAsync({
        title: name.trim(),
        todoHours: todo ? Number(todo) : undefined,
        actualHours: actual ? Number(actual) : undefined,
        assigneeId: assigneeId || undefined,
      })
      onClose()
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
          <FormField label="To Do (hrs)" htmlFor="task-todo">
            <Input
              id="task-todo"
              type="number"
              min={0}
              step={0.5}
              value={todo}
              onChange={(e) => setTodo(e.target.value)}
              placeholder="0"
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

          <FormField label="Estimate (hrs)">
            <div
              className="flex h-9 items-center rounded border border-input bg-input-background px-3 font-mono text-[13px]"
              style={{ color: BRAND.textPrimary }}
              title="Estimate is derived: To Do + Actuals"
              aria-readonly
            >
              {estimate}h
            </div>
          </FormField>
        </div>

        <FormField label="Owner" htmlFor="task-owner">
          <NativeSelect
            id="task-owner"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName ?? m.email ?? m.userId}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={submitting || !name.trim()}>
          {submitting && <Loader2 size={11} className="animate-spin" />}
          {submitting ? 'Creating…' : 'Create Task'}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
