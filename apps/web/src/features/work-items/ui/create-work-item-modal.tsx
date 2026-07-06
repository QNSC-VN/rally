/**
 * CreateWorkItemModal — P1-WI-CREATE
 *
 * Creates a Story or Defect work item from the backlog.
 * "Create" stays on backlog; "Create with details" navigates to the detail page.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateWorkItem, type WorkItem } from '@/features/work-items/api'
import { useProjectTeams } from '@/features/teams/api'
import { useProjectMembers } from '@/features/teams/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { BRAND } from '@/shared/config/brand'
import { WORK_ITEM_TYPE_CONFIG } from '@/entities/work-item/model/types'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'

type CreatableType = 'story' | 'defect'

interface Props {
  projectId: string
  onClose: () => void
  onCreated?: (item: WorkItem) => void
  onCreatedWithDetails?: (item: WorkItem) => void
}

export function CreateWorkItemModal({ projectId, onClose, onCreated, onCreatedWithDetails }: Props) {
  const { team } = useAppContext()
  const [type, setType] = useState<CreatableType>('story')
  const [title, setTitle] = useState('')
  // Auto-fill from the Team selected in the workspace context (falls back to "No team")
  const [teamId, setTeamId] = useState(team ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [storyPoints, setStoryPoints] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createMutation = useCreateWorkItem()
  const { data: teams = [] } = useProjectTeams(projectId)
  const { data: members = [] } = useProjectMembers(projectId)

  const titleRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef(submit)
  useEffect(() => {
    submitRef.current = submit
  })
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
        void submitRef.current(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const TYPE_OPTIONS: { value: CreatableType; label: string }[] = [
    { value: 'story', label: 'Story' },
    { value: 'defect', label: 'Defect' },
  ]

  return (
    <AppModal
      open
      onClose={onClose}
      title="New Work Item"
      subtitle={type === 'story' ? 'User Story' : 'Defect'}
      width={520}
    >
      <ModalBody className="space-y-4">
        {/* Type selector */}
        <FormField label="Type">
          <div className="flex gap-2">
            {TYPE_OPTIONS.map(({ value, label }) => {
              const cfg = WORK_ITEM_TYPE_CONFIG[value]
              const active = type === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className="flex-1 py-1.5 text-[11px] font-semibold rounded-sm transition-colors"
                  style={{
                    backgroundColor: active ? cfg.bg : 'transparent',
                    color: active ? cfg.color : BRAND.textSecondary,
                    border: `1px solid ${active ? cfg.color + '55' : BRAND.borderSubtle}`,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </FormField>

        {/* Title — intentionally larger font for primary field */}
        <FormField label="Title" required htmlFor="wi-title" error={error ?? undefined}>
          <Input
            id="wi-title"
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a concise, descriptive title…"
            className="text-[13px]"
          />
        </FormField>

        {/* Team + Owner row */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Team" htmlFor="wi-team">
            <NativeSelect id="wi-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Owner" htmlFor="wi-owner">
            <NativeSelect id="wi-owner" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ?? m.email ?? m.userId}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>

        {/* Plan estimate */}
        <FormField label="Plan Estimate (pts)" htmlFor="wi-estimate">
          <Input
            id="wi-estimate"
            type="number"
            min={0}
            step={1}
            value={storyPoints}
            onChange={(e) => setStoryPoints(e.target.value)}
            placeholder="0"
          />
        </FormField>
      </ModalBody>

      <ModalFooter className="justify-between">
        <span className="text-[10px]" style={{ color: BRAND.textMuted }}>
          Ctrl+Enter to save
        </span>
        <div className="flex gap-2">
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
            onClick={() => void submit(true)}
            disabled={submitting || !title.trim()}
            className="rounded px-4 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ border: '1px solid #9fb5d5', color: BRAND.primary, backgroundColor: '#f5f8fc' }}
          >
            Create with details
          </button>
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting || !title.trim()}
            className="flex items-center gap-1.5 rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND.primary }}
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {submitting ? 'Creating…' : 'Create Item'}
          </button>
        </div>
      </ModalFooter>
    </AppModal>
  )
}
