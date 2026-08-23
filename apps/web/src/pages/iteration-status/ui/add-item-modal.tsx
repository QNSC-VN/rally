import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

import { cn, EMPTY_VALUE } from '@/shared/lib/utils'
import { useCreateIterationItem, type IterationReference } from '@/features/iterations/api'
import { useProjectMemberOptions, useProjectTeams } from '@/features/teams/api'
import { useProjectTeamScope } from '@/features/access/api'
import { useDefaultOwner } from '@/shared/lib/hooks/use-default-owner'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { ProjectCell } from '@/shared/ui/project-cell'
import { TeamCell } from '@/shared/ui/team-cell'
import { TeamSelectField } from '@/shared/ui/entity-select-field'
import { Button } from '@/shared/ui/button'
import { FormField, ReadOnlyFieldValue } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { ownerSelectOptions } from '@/shared/ui/owner-cell'
import { fmtRange } from '../model/iteration-helpers'

export function AddItemModal({
  iteration,
  projectId,
  onClose,
  onCreated,
}: {
  // Reference, not the record: this modal shows the inherited Project/Team/Iteration read-only
  // (P2-IS-FR-044/045), which is name + window + team and nothing else.
  iteration: IterationReference
  projectId: string | undefined
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation('iteration-status')
  const navigate = useNavigate()
  const create = useCreateIterationItem(iteration.id)
  // The assignee feed, NOT the administrative roster: that one is Admin-only (§3.1:71), and
  // defaulting its 403 to `[]` made every owned item read `Unassigned` for an Editor.
  const { data: members = [] } = useProjectMemberOptions(projectId)
  const { data: teams = [], isLoading: teamsLoading } = useProjectTeams(projectId)
  const { project } = useAppContext()
  // Project / Team / Iteration are inherited from the iteration context and shown
  // read-only (P2-IS-FR-044/045); the created item picks them up server-side.
  const iterationTeam = teams.find((tm) => tm.id === iteration.teamId)
  // `--` when the iteration NAMES a team this reader cannot resolve: `GET /projects/:id/teams`
  // returns only an Editor's own teams, so a missing row means "another team", and printing
  // `No team` for it would state the opposite of the truth (`EMPTY_VALUE`, per its own docblock).
  const teamName = iterationTeam?.name ?? (iteration.teamId ? EMPTY_VALUE : t('toolbar.noTeam'))
  const teamKey = iterationTeam?.key ?? null
  /**
   * TWO different cases, and only one of them is a dead end (BA ruling 2026-08-17).
   *
   * A SHARED iteration (`teamId === null`) is the common one — 195 of 206 local iterations name no
   * team — and inheriting nothing there would file a Project Backlog item, which the server refuses
   * for an Editor. That is now fixable on the form: `CreateIterationItemDto` carries an optional
   * `teamId`, so the Editor picks one of their own teams and the item lands there. `useProjectTeams`
   * already returns only their teams, so the options cannot be wrong.
   *
   * ANOTHER team's iteration stays a dead end: whatever this form sent, the item would belong to that
   * team's sprint, which is `TEAM_NOT_IN_SCOPE`. Stated up front rather than left to the toast — but
   * only once the feed has resolved, since an empty list mid-flight is not evidence of anything.
   */
  const { teamRequired } = useProjectTeamScope(projectId)
  const sharedIteration = iteration.teamId === null
  const teamOutOfScope = teamRequired && !teamsLoading && !sharedIteration && !iterationTeam
  const mustChooseTeam = teamRequired && sharedIteration
  const [type, setType] = useState<'story' | 'defect'>('story')
  const [title, setTitle] = useState('')
  const [planEstimate, setPlanEstimate] = useState('')
  /**
   * Owner defaults to the current user when this modal's own feed offers them (`WIC-FR-006`) — the
   * same rule and the same gate Create Work Item applies, via the one shared hook so the two
   * surfaces cannot answer it differently.
   */
  const { ownerId: assigneeId, setOwnerId: setAssigneeId } = useDefaultOwner(members)
  const [teamTouched, setTeamTouched] = useState('')
  const [teamError, setTeamError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Server/submit failures aren't tied to one input — shown as a modal-level
  // banner, not under the Title field.
  const [formError, setFormError] = useState<string | null>(null)

  /**
   * DERIVED, not seeded into state: a single-team Editor should not be made to choose from a list of
   * one, and the teams feed resolves AFTER the first render — a `useState` initialiser would freeze
   * `''` in and the prefill would never arrive (the "state frozen before its source arrived" trap).
   * A touched value always wins, so the prefill can be changed or cleared.
   */
  const autoTeamId = mustChooseTeam && teams.length === 1 ? teams[0].id : ''
  const teamId = teamTouched || autoTeamId

  async function submit(openDetail = false) {
    setError(null)
    setFormError(null)
    if (!title.trim()) {
      setError(t('create.titleRequired'))
      return
    }
    // Belt as well as braces: the buttons are disabled for this case, but Enter-to-submit and a
    // stale render both reach here, and the server's refusal would arrive as a toast about a Team
    // this form never showed as editable.
    if (teamOutOfScope) {
      setFormError(t('create.teamOutOfScope'))
      return
    }
    // The server's own rule, said on the form: an Editor must name one of their Teams rather than
    // learn it from a 412 about a field they were never shown.
    setTeamError(null)
    if (mustChooseTeam && !teamId) {
      setTeamError(t('create.teamRequired'))
      return
    }
    try {
      const result = await create.mutateAsync({
        type,
        title: title.trim(),
        planEstimate: planEstimate === '' ? undefined : Number(planEstimate),
        assigneeId: assigneeId || undefined,
        // Omitted on a team-scoped iteration, where the server inherits the iteration's own team.
        teamId: teamId || undefined,
      })
      notify.success(
        t('create.added', {
          type: type === 'defect' ? t('create.defect') : t('create.story'),
          title: title.trim(),
        }),
      )
      if (openDetail) {
        void navigate({ to: '/item/$itemKey', params: { itemKey: result.itemKey } })
      } else {
        onCreated()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('create.createFailed')
      setFormError(msg)
      notify.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('create.title')}
      subtitle={`${iteration.name} · ${fmtRange(iteration)}`}
      width={460}
    >
      <ModalBody className="space-y-4">
        {formError && (
          <p role="alert" className="text-ui-sm text-destructive">
            {formError}
          </p>
        )}
        {/* Stated BEFORE the fields, because it is about the iteration and not about anything the
            reader is going to type. */}
        {teamOutOfScope && !formError && (
          <p role="alert" className="text-ui-sm text-destructive">
            {t('create.teamOutOfScope')}
          </p>
        )}
        {/* Type toggle */}
        <FormField label={t('create.typeLabel')}>
          <div className="flex gap-2">
            {(['story', 'defect'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setType(o)}
                className={cn(
                  'flex-1 rounded-sm border py-1.5 text-ui-sm font-semibold capitalize transition-colors',
                  type === o
                    ? 'border-accent-border bg-primary-lighter text-primary'
                    : 'border-border-subtle text-muted-foreground',
                )}
              >
                {o}
              </button>
            ))}
          </div>
        </FormField>

        {/* Project / Team / Iteration — read-only context (P2-IS-FR-044/045) */}
        <div className="grid grid-cols-2 gap-3">
          {/* Read-only per P2-IS-FR-044/045, but carrying the SAME glyphs the grids use —
              a `KeyChip` for the project and a square `TeamAvatar` for the team — so an
              inherited value looks like the value it was inherited from. */}
          <FormField label={t('create.projectLabel', 'Project')}>
            <ReadOnlyFieldValue>
              <ProjectCell projectKey={project?.projectKey} projectName={project?.projectName} />
            </ReadOnlyFieldValue>
          </FormField>
          {/* EDITABLE only where the iteration cannot answer it: a shared sprint carries no team, and
              an Editor must name one of theirs (BA ruling 2026-08-17). A team-scoped iteration still
              shows it read-only — inherited, per P2-IS-FR-044/045 — and an admin keeps that behaviour
              on a shared one too, because filing into the Project Backlog is theirs to do. */}
          {mustChooseTeam ? (
            <TeamSelectField
              value={teamId}
              onChange={(v) => setTeamTouched(v ?? '')}
              teams={teams}
              label={t('create.teamLabel', 'Team')}
              allowUnassigned={false}
              error={teamError ?? undefined}
            />
          ) : (
            <FormField label={t('create.teamLabel', 'Team')}>
              <ReadOnlyFieldValue>
                {iteration.teamId ? (
                  <TeamCell teamKey={teamKey} name={teamName} />
                ) : (
                  <span>{teamName}</span>
                )}
              </ReadOnlyFieldValue>
            </FormField>
          )}
        </div>
        <FormField label={t('create.iterationLabel', 'Iteration')}>
          <ReadOnlyFieldValue>{`${iteration.name} · ${fmtRange(iteration)}`}</ReadOnlyFieldValue>
        </FormField>

        <FormField label={t('create.titleLabel')} required error={error ?? undefined}>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a concise work item title..."
          />
        </FormField>

        <FormField label={t('create.planEstimateLabel')}>
          <Input
            type="number"
            min={0}
            value={planEstimate}
            onChange={(e) => setPlanEstimate(e.target.value)}
            placeholder="0"
          />
        </FormField>

        <FormField label={t('common:owner')}>
          <SearchableSelect
            variant="field"
            value={assigneeId}
            ariaLabel={t('common:owner')}
            placeholder={t('toolbar.unassigned')}
            options={ownerSelectOptions(members, assigneeId)}
            onChange={setAssigneeId}
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={create.isPending || teamOutOfScope}
          onClick={() => submit(true)}
        >
          {t('create.withDetails')}
        </Button>
        <Button
          type="button"
          disabled={create.isPending || teamOutOfScope}
          onClick={() => submit(false)}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('create.createItem')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
