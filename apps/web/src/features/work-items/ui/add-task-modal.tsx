/**
 * AddTaskModal — creates a child task under a work item.
 * P1-TASK-CREATE per SRS §04_Task_Management.
 */
import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateTask } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'

interface Props {
  workItemId: string
  onClose: () => void
}

export function AddTaskModal({ workItemId, onClose }: Props) {
  const { project } = useAppContext()
  const { data: members = [] } = useProjectMembers(project?.projectId)

  const [name, setName] = useState('')
  const [estimate, setEstimate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createTask = useCreateTask(workItemId)
  const nameRef = useRef<HTMLInputElement>(null)

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
        estimateHours: estimate ? Number(estimate) : undefined,
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

        <div className="grid grid-cols-2 gap-4">
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
        </div>
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
