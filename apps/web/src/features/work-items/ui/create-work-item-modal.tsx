/**
 * CreateWorkItemModal — P1-WI-CREATE
 *
 * Creates a Story or Defect work item from the backlog.
 * "Create" stays on backlog; "Create with details" navigates to the detail page.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateWorkItem, useBacklog, type WorkItem } from '@/features/work-items/api'
import { useProjectTeams } from '@/features/teams/api'
import { useProjectMembers } from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { BRAND } from '@/shared/config/brand'
import { WORK_ITEM_TYPE_CONFIG } from '@/entities/work-item/model/types'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { OwnerSelectField, TeamSelectField } from '@/shared/ui/entity-select-field'

type CreatableType = 'story' | 'defect'

interface Props {
  projectId: string
  onClose: () => void
  onCreated?: (item: WorkItem) => void
  onCreatedWithDetails?: (item: WorkItem) => void
}

export function CreateWorkItemModal({
  projectId,
  onClose,
  onCreated,
  onCreatedWithDetails,
}: Props) {
  const { workspace, team } = useAppContext()
  const workspaceId = workspace?.workspaceId ?? ''
  const [type, setType] = useState<CreatableType>('story')
  const [title, setTitle] = useState('')
  // Project defaults to the backlog's current project (WIC-FR-004) but can be
  // switched to any project the user can access; Team/Owner/Parent then filter
  // by the SELECTED project so an item can't be seeded with cross-project refs.
  const [selectedProjectId, setSelectedProjectId] = useState(projectId)
  // Auto-fill from the Team selected in the workspace context (falls back to "No team")
  const [teamId, setTeamId] = useState(team?.teamId ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [storyPoints, setStoryPoints] = useState('')
  const [parentStoryId, setParentStoryId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createMutation = useCreateWorkItem()
  const { data: projects = [] } = useProjects(workspaceId || undefined)
  const { data: teams = [] } = useProjectTeams(selectedProjectId)
  const { data: members = [] } = useProjectMembers(selectedProjectId)
  // Fetch stories for the parent dropdown (only used when type=defect)
  const { data: backlogData } = useBacklog(selectedProjectId, { type: 'story' })
  const stories = backlogData?.data ?? []

  // A pre-filled/inherited team that isn't linked to the selected project is
  // treated as unset so the backend can't reject the create with
  // PROJECT_TEAM_LINK_NOT_FOUND (DEV-007). Derived — no effect needed.
  const validTeamId = teams.some((t) => t.id === teamId) ? teamId : ''

  // When the project changes, reset project-scoped selections so no stale
  // cross-project team/owner/parent can be submitted.
  function handleProjectChange(nextProjectId: string) {
    if (nextProjectId === selectedProjectId) return
    setSelectedProjectId(nextProjectId)
    setTeamId('')
    setAssigneeId('')
    setParentStoryId('')
  }

  const titleRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef(submit)
  useEffect(() => {
    submitRef.current = submit
  })
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  async function submit(withDetails: boolean) {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const item = await createMutation.mutateAsync({
        projectId: selectedProjectId,
        type,
        title: title.trim(),
        priority: 'none',
        teamId: validTeamId || undefined,
        assigneeId: assigneeId || undefined,
        storyPoints: storyPoints ? Number(storyPoints) : undefined,
        parentId: type === 'defect' ? parentStoryId || undefined : undefined,
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
                  className="flex flex-1 items-center justify-center gap-1 rounded-sm py-1.5 text-ui-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: active ? cfg.bg : 'transparent',
                    color: active ? cfg.color : BRAND.textSecondary,
                    border: `1px solid ${active ? cfg.color + '55' : BRAND.borderSubtle}`,
                  }}
                >
                  {cfg.icon && <cfg.icon size={12} strokeWidth={2.2} />}
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
            className="text-ui-lg"
          />
        </FormField>

        {/* Project — required, default current project (WIC-FR-004) */}
        <FormField label="Project" required htmlFor="wi-project">
          <NativeSelect
            id="wi-project"
            value={selectedProjectId}
            onChange={(e) => handleProjectChange(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        {/* Parent Story — Defect only */}
        {type === 'defect' && (
          <FormField label="Parent Story" htmlFor="wi-parent-story">
            <NativeSelect
              id="wi-parent-story"
              value={parentStoryId}
              onChange={(e) => setParentStoryId(e.target.value)}
            >
              <option value="">No parent story</option>
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.itemKey} — {s.title}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}

        {/* Team + Owner row */}
        <div className="grid grid-cols-2 gap-4">
          <TeamSelectField id="wi-team" value={validTeamId} onChange={setTeamId} teams={teams} />
          <OwnerSelectField
            id="wi-owner"
            value={assigneeId}
            onChange={setAssigneeId}
            members={members}
          />
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
        <span className="text-ui-xs text-foreground-subtle">Ctrl+Enter to save</span>
        <div className="flex gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => void submit(true)}
            disabled={submitting || !title.trim()}
          >
            Create with details
          </Button>
          <Button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting || !title.trim()}
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {submitting ? 'Creating…' : 'Create Item'}
          </Button>
        </div>
      </ModalFooter>
    </AppModal>
  )
}
