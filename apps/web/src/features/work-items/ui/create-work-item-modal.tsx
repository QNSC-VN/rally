/**
 * CreateWorkItemModal — P1-WI-CREATE
 *
 * Creates a Story or Defect work item from the backlog.
 * "Create" stays on backlog; "Create with details" navigates to the detail page.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useCreateWorkItem, type WorkItem } from '@/features/work-items/api'
import { useProjectTeams } from '@/features/teams/api'
import { useProjectMembers } from '@/features/teams/api'
import { WORK_ITEM_TYPE_CONFIG } from '@/entities/work-item/model/types'

type CreatableType = 'story' | 'defect'

interface Props {
  projectId: string
  onClose: () => void
  onCreated?: (item: WorkItem) => void
  onCreatedWithDetails?: (item: WorkItem) => void
}

export function CreateWorkItemModal({ projectId, onClose, onCreated, onCreatedWithDetails }: Props) {
  const [type, setType] = useState<CreatableType>('story')
  const [title, setTitle] = useState('')
  const [teamId, setTeamId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [storyPoints, setStoryPoints] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createMutation = useCreateWorkItem()
  const { data: teams = [] } = useProjectTeams(projectId)
  const { data: members = [] } = useProjectMembers(projectId)

  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  async function submit(withDetails: boolean) {
    if (!title.trim()) { setError('Title is required.'); return }
    setError(null)
    setSubmitting(true)
    try {
      const item = await createMutation.mutateAsync({
        projectId,
        type,
        title: title.trim(),
        priority: 'none',
        teamId: teamId || undefined,
        assigneeId: assigneeId || undefined,
        storyPoints: storyPoints ? Number(storyPoints) : undefined,
      })
      if (withDetails) {
        onCreatedWithDetails?.(item)
      } else {
        onCreated?.(item)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create work item.')
    } finally {
      setSubmitting(false)
    }
  }

  // Keyboard shortcut: Ctrl+Enter to create
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        void submit(false)
      }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const TYPE_OPTIONS: { value: CreatableType; label: string }[] = [
    { value: 'story', label: 'Story' },
    { value: 'defect', label: 'Defect' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.28)' }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-wi-title"
        className="relative bg-white rounded shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 520, maxHeight: '80vh', border: '1px solid #d4d8de' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5 shrink-0"
          style={{ backgroundColor: '#f7f8fa', borderBottom: '1px solid #e2e6eb' }}
        >
          <div>
            <p id="create-wi-title" className="text-[13px] font-semibold" style={{ color: '#1a2234' }}>
              New Work Item
            </p>
            <p className="text-[11px]" style={{ color: '#8c94a6' }}>
              {type === 'story' ? 'User Story' : 'Defect'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded"
            style={{ color: '#8c94a6' }}
            aria-label="Close"
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#edf0f4'
              e.currentTarget.style.color = '#1a2234'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#8c94a6'
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Type selector */}
          <div>
            <label
              className="block text-[10px] font-semibold uppercase tracking-widest mb-2"
              style={{ color: '#5c6478' }}
            >
              Type
            </label>
            <div className="flex gap-2">
              {TYPE_OPTIONS.map(({ value, label }) => {
                const cfg = WORK_ITEM_TYPE_CONFIG[value]
                const active = type === value
                return (
                  <button
                    key={value}
                    onClick={() => setType(value)}
                    className="flex-1 py-1.5 text-[11px] font-semibold rounded-sm transition-colors"
                    style={{
                      backgroundColor: active ? cfg.bg : 'transparent',
                      color: active ? cfg.color : '#5c6478',
                      border: `1px solid ${active ? cfg.color + '55' : '#dde2ea'}`,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label
              htmlFor="wi-title"
              className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
              style={{ color: '#5c6478' }}
            >
              Title <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              id="wi-title"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a concise, descriptive title…"
              className="w-full text-[13px] px-3 py-2 rounded focus:outline-none"
              style={{ border: '1px solid #dde2ea', color: '#1a2234' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(29,63,115,0.4)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#dde2ea')}
            />
          </div>

          {/* Team + Owner row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="wi-team"
                className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
                style={{ color: '#5c6478' }}
              >
                Team
              </label>
              <select
                id="wi-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full text-[12px] px-2.5 py-1.5 rounded focus:outline-none bg-white"
                style={{ border: '1px solid #dde2ea', color: '#1a2234' }}
              >
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="wi-owner"
                className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
                style={{ color: '#5c6478' }}
              >
                Owner
              </label>
              <select
                id="wi-owner"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full text-[12px] px-2.5 py-1.5 rounded focus:outline-none bg-white"
                style={{ border: '1px solid #dde2ea', color: '#1a2234' }}
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

          {/* Plan estimate */}
          <div>
            <label
              htmlFor="wi-estimate"
              className="block text-[10px] font-semibold uppercase tracking-widest mb-1.5"
              style={{ color: '#5c6478' }}
            >
              Plan Estimate (pts)
            </label>
            <input
              id="wi-estimate"
              type="number"
              min={0}
              step={1}
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
              placeholder="0"
              className="w-full text-[12px] px-2.5 py-1.5 rounded focus:outline-none"
              style={{ border: '1px solid #dde2ea', color: '#1a2234' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(29,63,115,0.4)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#dde2ea')}
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-[11px]" style={{ color: '#b91c1c' }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid #e2e6eb', backgroundColor: '#f7f8fa' }}
        >
          <span className="text-[10px]" style={{ color: '#8c94a6' }}>
            Ctrl+Enter to save
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-1.5 text-[12px] font-medium rounded disabled:opacity-50"
              style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#edf0f4')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Cancel
            </button>
            <button
              onClick={() => void submit(true)}
              disabled={submitting || !title.trim()}
              className="px-4 py-1.5 text-[12px] font-semibold rounded disabled:opacity-50"
              style={{ border: '1px solid #9fb5d5', color: '#1d3f73', backgroundColor: '#f5f8fc' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e8eff8')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f5f8fc')}
            >
              Create with details
            </button>
            <button
              onClick={() => void submit(false)}
              disabled={submitting || !title.trim()}
              className="px-4 py-1.5 text-[12px] font-semibold text-white rounded disabled:opacity-50"
              style={{ backgroundColor: '#1d3f73' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#163259')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1d3f73')}
            >
              {submitting ? 'Creating…' : 'Create Item'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
