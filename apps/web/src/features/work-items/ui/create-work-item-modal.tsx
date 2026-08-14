/**
 * CreateWorkItemModal — P1-WI-CREATE
 *
 * Creates a Story or Defect work item from the backlog.
 * "Create" stays on backlog; "Create with details" navigates to the detail page.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useCreateWorkItem, useBacklog, type WorkItem } from '@/features/work-items/api'
import { useProjectTeams } from '@/features/teams/api'
import { useProjectMemberOptions } from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { BRAND } from '@/shared/config/brand'
import { WORK_ITEM_TYPE_CONFIG } from '@/entities/work-item/model/types'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { OwnerSelectField, TeamSelectField } from '@/shared/ui/entity-select-field'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { KeyChip } from '@/shared/ui/key-chip'
import { TypeBadge } from '@/entities/work-item/ui/badges'

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
  const { t } = useTranslation('work-items')
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
  // Owner defaults to the authenticated creator (still changeable, incl. Unassigned).
  const currentUserId = useAuthStore((s) => s.user?.id)
  const [assigneeId, setAssigneeId] = useState(() => currentUserId ?? '')
  const [storyPoints, setStoryPoints] = useState('')
  const [parentStoryId, setParentStoryId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)
  // Server/submit failures aren't tied to one input — shown as a modal-level
  // banner, not under the Title field.
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const createMutation = useCreateWorkItem()
  const { data: projects = [] } = useProjects(workspaceId || undefined)
  const { data: teams = [] } = useProjectTeams(selectedProjectId)
  // Owner PICKER — the reference feed, not the Admin-only roster.
  const { data: members = [] } = useProjectMemberOptions(selectedProjectId)
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
      setError(t('create.titleRequired'))
      return
    }
    // Team is OPTIONAL. Blank means the item belongs to the PROJECT backlog, which is the
    // documented default state — three sources, no dissent:
    //   WIC-FR-005: "Team optional; default blank/Project backlog unless current Team context is
    //     explicitly selected and valid for the Project."
    //   GAP-P1-CREATE-003 (P0): "Team is optional: blank = Project backlog, selected Team = Team
    //     backlog."
    //   GAP-P1-WID-008: "Apply LATEST Team optional rule: blank Team = Project backlog."
    //
    // This used to refuse a blank Team, citing "SoT: Team is required for a Backlog Work Item" —
    // a rule that appears in neither RECONCILED_SOURCE_OF_TRUTH.md nor BUSINESS_BASELINE.md, and
    // which GAP-P1-WID-008's "latest" wording says was superseded. The API has always accepted a
    // null `teamId`, so the refusal lived only here and made the spec's own DEFAULT state
    // unreachable through the UI.
    //
    // What still holds is the SECOND half of the rule: a chosen Team must belong to the selected
    // Project. `validTeamId` enforces it by construction — the list is project-filtered, so a
    // stale selection resolves to '' rather than being sent.
    setError(null)
    setTeamError(null)
    setFormError(null)
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
      setFormError(e instanceof Error ? e.message : t('create.createFailed'))
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
    { value: 'story', label: t('types.story') },
    { value: 'defect', label: t('types.defect') },
  ]

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('create.title')}
      subtitle={type === 'story' ? t('create.subtitleStory') : t('create.subtitleDefect')}
      width={520}
    >
      <ModalBody className="space-y-4">
        {formError && (
          <p role="alert" className="text-ui-sm text-destructive">
            {formError}
          </p>
        )}
        {/* Type selector */}
        <FormField label={t('create.typeLabel')}>
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
        <FormField
          label={t('create.titleLabel')}
          required
          htmlFor="wi-title"
          error={error ?? undefined}
        >
          <Input
            id="wi-title"
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('create.titlePlaceholder')}
            className="text-ui-lg"
          />
        </FormField>

        {/* Project — required, default current project (WIC-FR-004) */}
        {/* The `KeyChip` glyph `ProjectSelectCell` puts on every Project column, so the field
            and the column are recognisably the same thing. Was a bare `NativeSelect` listing
            names only — searchable too, since a workspace can hold a long project list. */}
        <FormField label={t('create.projectLabel')} required>
          <SearchableSelect
            variant="field"
            value={selectedProjectId}
            ariaLabel={t('create.projectLabel')}
            searchPlaceholder="Search"
            options={projects.map((p) => ({
              value: p.id,
              label: p.name,
              searchText: `${p.key} ${p.name}`,
              icon: (
                <KeyChip size="sm" tone="project">
                  {p.key}
                </KeyChip>
              ),
            }))}
            onChange={(v) => handleProjectChange(v ?? selectedProjectId)}
          />
        </FormField>

        {/* Parent Story — Defect only. Carries the story `TypeBadge`, the same glyph the ID
            column renders. */}
        {type === 'defect' && (
          <FormField label={t('create.parentStoryLabel')}>
            <SearchableSelect
              variant="field"
              value={parentStoryId}
              ariaLabel={t('create.parentStoryLabel')}
              searchPlaceholder="Search"
              options={[
                { value: '', label: t('sidebar.noParentStory') },
                ...stories.map((s) => ({
                  value: s.id,
                  label: `${s.itemKey} — ${s.title}`,
                  searchText: `${s.itemKey} ${s.title}`,
                  icon: <TypeBadge type="story" size={16} />,
                })),
              ]}
              onChange={(v) => setParentStoryId(v ?? '')}
            />
          </FormField>
        )}

        {/* Team + Owner row */}
        <div className="grid grid-cols-2 gap-4">
          <TeamSelectField
            id="wi-team"
            value={validTeamId}
            onChange={(v) => {
              setTeamId(v)
              setTeamError(null)
            }}
            teams={teams}
            /* Blank is a legal, and the DEFAULT, choice — WIC-FR-005 / GAP-P1-CREATE-003. Without
               the unassigned option the field could not express "Project backlog" at all. */
            allowUnassigned
            error={teamError ?? undefined}
          />
          <OwnerSelectField
            id="wi-owner"
            value={assigneeId}
            onChange={setAssigneeId}
            members={members}
          />
        </div>

        {/* Plan estimate */}
        <FormField label={t('create.planEstimateLabel')} htmlFor="wi-estimate">
          <Input
            id="wi-estimate"
            type="number"
            min={0}
            step={1}
            value={storyPoints}
            onChange={(e) => setStoryPoints(e.target.value)}
            placeholder={t('create.estimatePlaceholder')}
          />
        </FormField>
      </ModalBody>

      <ModalFooter className="justify-between">
        <span className="text-ui-xs text-foreground-subtle">{t('create.saveHint')}</span>
        <div className="flex gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => void submit(true)}
            disabled={submitting || !title.trim()}
          >
            {t('create.createWithDetails')}
          </Button>
          <Button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting || !title.trim()}
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {submitting ? t('create.creating') : t('create.createButton')}
          </Button>
        </div>
      </ModalFooter>
    </AppModal>
  )
}
