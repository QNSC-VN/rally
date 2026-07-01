/**
 * AddTaskModal — creates a child task under a work item.
 * P1-TASK-CREATE per SRS §04_Task_Management.
 */
import { useRef, useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useCreateTask } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'

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

  useEffect(() => { nameRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit() {
    if (!name.trim()) { setError('Name is required.'); return }
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

  const fieldCls = 'w-full text-[12px] px-3 py-2 rounded bg-white focus:outline-none'
  const fieldSty = { border: '1px solid #d7dde7', color: '#1a2234' } as const

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.42)' }}
    >
      <section
        className="w-full max-w-[520px] rounded bg-white shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-task-title"
        style={{ border: '1px solid #cbd5e1' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #dde2ea' }}
        >
          <div>
            <h2 id="add-task-title" className="text-[16px] font-semibold" style={{ color: '#1f2937' }}>
              Create Task
            </h2>
            <p className="text-[11px] mt-1" style={{ color: '#64748b' }}>
              Create a child task under this work item.
            </p>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="p-1 rounded"
            style={{ color: '#8c94a6' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="task-name"
              className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
              style={{ color: '#64748b' }}
            >
              Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              id="task-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter task name"
              className={fieldCls}
              style={fieldSty}
            />
            {error && (
              <p className="mt-1.5 text-[10px]" style={{ color: '#b45309' }}>
                {error}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Estimate */}
            <div>
              <label
                htmlFor="task-estimate"
                className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
                style={{ color: '#64748b' }}
              >
                Estimate (hrs)
              </label>
              <input
                id="task-estimate"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                type="number"
                min={0}
                step={0.5}
                placeholder="0"
                className={fieldCls}
                style={fieldSty}
              />
            </div>

            {/* Owner */}
            <div>
              <label
                htmlFor="task-owner"
                className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
                style={{ color: '#64748b' }}
              >
                Owner
              </label>
              <select
                id="task-owner"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={fieldCls}
                style={fieldSty}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email ?? m.userId}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-4"
          style={{ backgroundColor: '#f8fafc', borderTop: '1px solid #dde2ea' }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded text-[12px] font-semibold disabled:opacity-50"
            style={{ color: '#334155', border: '1px solid #cbd5e1', backgroundColor: 'white' }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !name.trim()}
            className="px-4 py-2 rounded text-[12px] font-semibold text-white disabled:opacity-45"
            style={{ backgroundColor: '#1d3f73' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#163259')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1d3f73')}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </section>
    </div>
  )
}
