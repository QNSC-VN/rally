/**
 * AddTaskModal — creates a child task under a work item.
 * P1-TASK-CREATE per SRS §04_Task_Management.
 */
import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateTask } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'

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
            <select
              id="task-owner"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded border border-input bg-white px-3 py-2 text-[12px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ?? m.email ?? m.userId}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded px-3.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[#f0f2f5] disabled:opacity-50"
          style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !name.trim()}
          className="flex items-center gap-1.5 rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.primary }}
        >
          {submitting && <Loader2 size={11} className="animate-spin" />}
          {submitting ? 'Creating…' : 'Create Task'}
        </button>
      </ModalFooter>
    </AppModal>
  )
}
