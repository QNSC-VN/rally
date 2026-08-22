/**
 * The Users & Permissions roster used by Settings > Workspaces & Projects.
 *
 * Lists a project's members with each access level (admin / editor), lets a Workspace
 * Admin change a level, remove access (No Access = row removed), and ADD an existing
 * workspace user at a chosen level plus their Teams in one step. Two levels
 * (Admin / Editor) plus implicit No Access; no Viewer.
 *
 * **Choosing `Editor` here opens Team selection and defers the write** (SRS §5.2:
 * "Selecting Editor opens Team selection"). It used to PATCH the level on change and
 * stop, so demoting an Admin produced — in one click, with no prompt — an Editor with
 * zero teams: the state §2.2 forbids ("Editor must be assigned to at least one active
 * Team"), which this roster's own `WarningIndicator` then flagged. The level and the
 * `team_members` rows now travel together through `EditorTeamsModal`, whose Save is
 * disabled until at least one team is checked, exactly as the BA mockup's
 * `EditorTeamsModal` does (`WorkspaceProjectsPanel.tsx`:208-226, 471).
 *
 * **`Admin` needs no Team step and says `All Teams` instead** (§5.2: "Selecting Admin
 * automatically grants `All Teams`"; §2.2: "individual Team selection is not shown").
 * That is a fact about the backend, not a shortcut: `assertTeamScoped` skips team
 * scoping for Admin, so All Teams is the ABSENCE of a scope and there is nothing to
 * write. Promoting an Editor to Admin therefore commits immediately and deliberately
 * LEAVES their existing `team_members` rows alone — those rows carry delivery meaning
 * (assignment, Team Status, capacity) that no §2.2 rule asks a level change to destroy,
 * and keeping them makes a later demotion back to Editor lossless. Only `Remove` clears
 * team membership (§5.2).
 */
import { useState } from 'react'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useMutation } from '@tanstack/react-query'
import {
  useProjectAccessRoster,
  useSetProjectAccess,
  useProjectTeams,
  useUserTeamMemberships,
  type ProjectMember,
} from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { memberSelectOption, OwnerAvatar } from '@/shared/ui/owner-cell'
import { teamSelectOption } from '@/shared/ui/team-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { WarningIndicator } from '@/shared/ui/warning-indicator'
import { WorkspaceAdminBadge } from '@/shared/ui/workspace-admin-badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { notify } from '@/shared/lib/toast'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { AllTeamsChip } from '@/shared/ui/all-teams-chip'
import {
  accessSelectOptions,
  grantsAllTeams,
  requiresTeamSelection,
  TEAM_SCOPED_LEVEL,
  type AccessLevel,
} from '@/shared/config/access-levels'

/**
 * Best-available display label for a roster row — and the string the typed removal confirmation
 * asks for, which is why it is a function rather than the same three-way `??` written out four
 * times. A typed confirmation whose expected value is computed differently from the name on screen
 * is unsatisfiable, so the two have to come from one place.
 */
function memberLabel(m: ProjectMember): string {
  return m.displayName ?? m.email ?? m.userId
}

export function ProjectAccessList({ projectId, isWA }: { projectId: string; isWA: boolean }) {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: members = [], isLoading } = useProjectAccessRoster(projectId)
  const setAccess = useSetProjectAccess(projectId)
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null)
  const [editorTarget, setEditorTarget] = useState<ProjectMember | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = members.filter((m) =>
    `${m.displayName ?? ''} ${m.email ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  )

  /**
   * The one level-write path on this roster, shared with `EditorTeamsModal` so the two entry points
   * cannot drift between the immediate (Admin) and deferred (Editor) journeys.
   *
   * ONE request, level and Teams together (PRJ-08). It used to branch between POST and PATCH — a NULL
   * `access_level` row is team-derived, so its `id` is a `team_members` id and PATCHing it 404s — and
   * the Teams were a second set of requests after it. The combined endpoint upserts either row shape,
   * so the branch and the follow-up writes are both gone.
   *
   * `teamIds` is passed through rather than defaulted: absent means "leave the memberships alone",
   * which is what an Admin promotion must send.
   */
  async function writeLevel(member: ProjectMember, level: AccessLevel, teamIds?: string[]) {
    await setAccess.mutateAsync({
      userId: member.userId,
      accessLevel: level,
      ...(teamIds ? { teamIds } : {}),
    })
  }

  /**
   * §5.2: "Selecting Editor opens Team selection" — so Editor does NOT write here. The
   * team modal owns that write, and re-picking Editor for someone who already holds it
   * is the roster's way back into their team list (this list has no Teams column).
   */
  function handleSelectLevel(member: ProjectMember, level: AccessLevel) {
    if (requiresTeamSelection(level)) {
      setEditorTarget(member)
      return
    }
    writeLevel(member, level)
      .then(() => notify.success(`Access updated to ${level}`))
      .catch((e) => notify.fromError(e, 'Failed to update access'))
  }

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error, response } = await apiClient.DELETE('/v1/projects/{id}/members/{userId}', {
        params: { path: { id: projectId, userId: memberId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['team'] },
  })

  function handleRemove() {
    if (!removeTarget) return
    removeMember.mutate(removeTarget.userId, {
      onSuccess: () => {
        notify.success('Access removed (No Access)')
        setRemoveTarget(null)
      },
      onError: (e) => notify.fromError(e, 'Failed to remove access'),
    })
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users…"
          className="max-w-xs"
          aria-label="Search project users"
        />
        {isWA && (
          <Button type="button" onClick={() => setAddOpen(true)}>
            <UserPlus size={14} /> Add existing user
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-ui-md text-foreground-subtle">
          <Loader2 size={14} className="animate-spin" /> Loading members…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-8 text-center text-ui-md text-foreground-subtle">
          {query ? 'No users match your search.' : 'No members in this project yet.'}
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle">
          <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
            <span className="flex-1">{t('access.colUser')}</span>
            <span className="w-24 text-center">{t('access.colStatus')}</span>
            <span className="w-28 text-center">{t('access.colAccessLevel')}</span>
            {isWA && <span className="w-8 text-center">{t('access.colAction')}</span>}
          </div>
          {filtered.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <OwnerAvatar name={memberLabel(m)} size={20} />
                <div className="min-w-0">
                  <p className="truncate text-ui-sm font-medium text-foreground">
                    {m.displayName ?? m.email ?? '--'}
                  </p>
                  {m.email && (
                    <p className="truncate text-ui-xs text-foreground-subtle">{m.email}</p>
                  )}
                </div>
              </div>
              <div className="w-24 text-center">
                <span className="text-ui-xs text-foreground-subtle capitalize">{m.status}</span>
              </div>
              <div className="flex w-28 flex-col items-start gap-0.5">
                <div className="flex w-full items-center gap-1">
                  <WarningIndicator
                    labels={
                      m.accessLevel === 'editor' && m.teamCount === 0
                        ? [
                            `Editor has no assigned team — can't act on any work in this project yet.`,
                          ]
                        : []
                    }
                  />
                  {m.isWorkspaceAdmin ? (
                    /* A system row: the authority is the workspace-wide grant, so there is no level
                       to choose and nothing to remove. Stating it as the badge rather than as an
                       Access Level keeps §2.1 readable — this person holds no project row. */
                    <WorkspaceAdminBadge />
                  ) : m.accessLevel && isWA ? (
                    <SearchableSelect
                      variant="cell"
                      value={m.accessLevel}
                      ariaLabel={`Access level for ${memberLabel(m)}`}
                      options={accessSelectOptions}
                      onChange={(v) => handleSelectLevel(m, v as AccessLevel)}
                    />
                  ) : (
                    <span className="text-ui-sm text-foreground-subtle capitalize">
                      {m.accessLevel ?? EMPTY_VALUE}
                    </span>
                  )}
                </div>
                {/* §5.2: an Admin's scope IS every team, so the cell says so instead of
                    offering a picker (mockup `WorkspaceProjectsPanel.tsx`:472). Rendered
                    for a read-only reader too — that reader is the one with no dropdown
                    to infer it from. */}
                {!m.isWorkspaceAdmin && grantsAllTeams(m.accessLevel) && (
                  <span className="text-ui-xs text-foreground-subtle">{t('access.allTeams')}</span>
                )}
              </div>
              {isWA && (
                <div className="w-8 text-center">
                  {/* Nothing to remove on a system row — there is no `project_members` record, and the
                      route would 404. The cell stays for column alignment. */}
                  {m.isWorkspaceAdmin ? null : (
                    <IconButton
                      size="sm"
                      aria-label="Remove access"
                      title="Remove access (No Access)"
                      onClick={() => setRemoveTarget(m)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/*
        TYPED target confirmation (GAP-P4-SET-004) — the BA reserves that for exactly this action
        ("Remove User Access requires typed target confirmation"), and it is the one destructive
        action on this roster that is not reversible by an equal-and-opposite click: it deletes the
        `project_members` row AND every one of that user's `team_members` rows for this project
        (§5.2), so re-adding them restores the level but not the team memberships. The dialog already
        named the target; it committed on one click of a 13px icon in a dense row.

        Same shape and same copy source as the Members grid's Remove Access
        (`members-tab.tsx`), which is the model this aligns to.
      */}
      <ConfirmDialog
        open={!!removeTarget}
        title={t('access.removeAccessTitle')}
        message={
          removeTarget ? t('access.removeAccessConfirm', { name: memberLabel(removeTarget) }) : ''
        }
        confirmText={removeTarget ? memberLabel(removeTarget) : undefined}
        confirmLabel={t('access.removeAccessConfirmLabel')}
        destructive
        pending={removeMember.isPending}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />

      <AddExistingUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={projectId}
        workspaceId={workspaceId}
        existingIds={new Set(members.map((m) => m.userId))}
      />

      {/* Mounted only while open: it fans out one request per project team to seed the
          member's current teams, which is work no closed dialog should be doing. */}
      {editorTarget && (
        <EditorTeamsModal
          projectId={projectId}
          member={editorTarget}
          writeLevel={writeLevel}
          onClose={() => setEditorTarget(null)}
        />
      )}
    </>
  )
}

/**
 * The Team step `Editor` opens (SRS §5.2 :167), and the only place this roster writes a
 * member's `team_members` rows.
 *
 * Save is disabled until at least one team is checked — §2.2's "Editor must be assigned
 * to at least one active Team", and the mockup's own `disabled={draftTeamIds.length === 0}`
 * (`WorkspaceProjectsPanel.tsx`:222). The ONE exception is a project with no active teams
 * at all: there the rule is unsatisfiable by any action available here, so Save writes the
 * level alone rather than trapping the Workspace Admin in a dialog that cannot be
 * completed. The roster's `WarningIndicator` then reports the resulting Editor honestly.
 *
 * The level write goes through the parent's `writeLevel`, so both journeys share one
 * POST-vs-PATCH rule. It goes LAST — see `handleSave` for why the order is load-bearing.
 */
function EditorTeamsModal({
  projectId,
  member,
  writeLevel,
  onClose,
}: {
  projectId: string
  member: ProjectMember
  writeLevel: (member: ProjectMember, level: AccessLevel, teamIds?: string[]) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('settings')
  const { data: teams = [] } = useProjectTeams(projectId)
  const teamIds = teams.map((tm) => tm.id)
  const { memberTeamIds, isLoading } = useUserTeamMemberships(teamIds, member.userId)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [pending, setPending] = useState(false)
  const label = member.displayName ?? member.email ?? member.userId

  // Seeded from the member's CURRENT teams once they resolve (mockup: `useState(() =>
  // selectedTeamIds.filter(...))`), then owned by the dialog — `null` means "not seeded
  // yet", which is not the same as "seeded empty" and must not be overwritten later.
  const selected = draft ?? memberTeamIds
  // `teamSelectOption`, so these rows carry the same square avatar `TeamCell` and `TeamSelectField`
  // draw. A multi-select cannot use that field, which is why the builder is separate from it.
  const options: SelectOption[] = teams.map((tm) => teamSelectOption(tm))
  const canSave = !isLoading && (selected.length > 0 || teams.length === 0)

  /**
   * ONE request: the level and the team set together (PRJ-08).
   *
   * This used to be a sequence — every add, then every remove, then the level LAST — and the ordering
   * was load-bearing for a reason worth keeping on record: written level-first, one failed
   * `addTeamMember` (a 500, a dropped connection) left the level ALREADY landed with no team rows
   * behind it. That is an Editor with zero teams, §2.2's forbidden state, reached through a network
   * error instead of a click, and the exact state this Team step exists to make unreachable. Ordering
   * the writes only narrowed the window; the combined endpoint applies both halves in one transaction,
   * so the window is gone and the server can refuse the invalid state outright.
   *
   * `'editor'` is written unconditionally now rather than only when the member does not already hold
   * it: the same request carries the teams either way, so there is no second write to skip.
   */
  async function handleSave() {
    setPending(true)
    try {
      await writeLevel(member, TEAM_SCOPED_LEVEL, selected)
      notify.success('Access updated to editor')
      onClose()
    } catch (e) {
      notify.fromError(e, 'Failed to update access')
    } finally {
      setPending(false)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('access.assignEditorTeams')}
      subtitle={label}
      width={440}
    >
      <ModalBody className="space-y-3">
        {teams.length === 0 ? (
          <p className="text-ui-sm text-foreground-subtle">{t('access.projectHasNoTeams')}</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <p className="text-ui-sm font-medium text-foreground">{t('access.teams')}</p>
              <SearchableSelect
                multiple
                variant="field"
                value={selected}
                readOnly={isLoading}
                ariaLabel={t('access.teams')}
                placeholder={t('access.selectTeams')}
                searchPlaceholder={t('access.searchTeams')}
                options={options}
                onChange={(v) => setDraft(v)}
              />
            </div>
            <p
              className={
                selected.length === 0
                  ? 'text-ui-xs text-warning'
                  : 'text-ui-xs text-foreground-subtle'
              }
            >
              {t('access.editorNeedsTeam')}
            </p>
          </>
        )}
        <p className="text-ui-xs text-foreground-subtle">{t('access.levelStaysUntilSaved')}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSave || pending} onClick={handleSave}>
          {pending && <Loader2 size={12} className="animate-spin" />}
          {t('access.saveAccess')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

/**
 * Pick an active workspace user who is not yet a project member, choose a level, and
 * (when Editor) their Teams — all in one modal, one "Add to project" action, matching
 * the BA mockup's single-modal shape — and ONE request, `useSetProjectAccess`, which carries the
 * level and the Teams together (PRJ-08). It used to be a `POST /projects/{id}/members` for the level
 * followed by one `POST /teams/{id}/members` per selected team, with the team failures merely
 * TOASTED (`.catch(notify.fromError)`) — so an Editor could be added with the level landed and every
 * team write failed, the state §2.2 forbids, reported as a warning rather than a refusal. One
 * transaction makes that unreachable and the server refuses the invalid combination outright.
 *
 * Admin bypasses Team scoping entirely (`access.service.ts`'s `assertTeamScoped`), so the
 * Teams picker only renders for Editor and Admin reads `All Teams` instead (§2.2).
 *
 * An Editor with zero teams checked BLOCKS the submit, as it does in the mockup
 * (`canAdd = Boolean(selectedId) && (permission !== "Editor" || selectedTeamIds.length > 0)`,
 * `WorkspaceProjectsPanel.tsx`:235) and as §2.2 requires. This docblock previously claimed
 * the mockup "only ever showed this as inline validation copy, never a disabled submit" —
 * it does both, in both of its dialogs. The one relaxation is a project with no teams yet:
 * blocking there would make an Editor unaddable to a project that has nothing to assign,
 * so the copy explains it instead and the add proceeds.
 */
function AddExistingUserModal({
  open,
  onClose,
  projectId,
  workspaceId,
  existingIds,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  workspaceId: string | undefined
  existingIds: Set<string>
}) {
  const { t } = useTranslation('settings')
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId)
  const { data: teams = [] } = useProjectTeams(projectId)
  const setAccess = useSetProjectAccess(projectId)
  const [userId, setUserId] = useState<string | null>(null)
  const [level, setLevel] = useState<AccessLevel>(TEAM_SCOPED_LEVEL)
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])

  // Workspace Admin is company-level only — never a Project member candidate (§2). This filter
  // SURVIVED the BA's Workspace-Admin team-membership ruling, which reversed the identical-looking
  // one in `project-teams-tab.tsx`: that one gated TEAM membership, which is now allowed, while this
  // one gates the `project_members` row the ruling still withholds ("must NOT create or require an
  // Admin/Editor Project Access assignment"; migration 0118 deletes any that exist). Two filters,
  // one sentence of §2.1, and only one of them moved — do not "align" them.
  const candidates = wsMembers.filter(
    (m) => !existingIds.has(m.userId) && m.status === 'active' && m.roleSlug !== 'workspace_admin',
  )
  // The shared builders: same avatar as the roster rows a few lines up, same email matching.
  const options: SelectOption[] = candidates.map((m) => memberSelectOption(m))
  const teamOptions: SelectOption[] = teams.map((tm) => teamSelectOption(tm))
  // §2.2: an Editor must hold at least one Team — enforced, not merely warned (mockup
  // `canAdd`, :235). Relaxed only when the project has no team to choose.
  const missingTeam =
    requiresTeamSelection(level) && teamOptions.length > 0 && selectedTeamIds.length === 0

  function handleClose() {
    setUserId(null)
    setLevel(TEAM_SCOPED_LEVEL)
    setSelectedTeamIds([])
    onClose()
  }

  function handleAdd() {
    if (!userId) return
    setAccess.mutate(
      {
        userId,
        accessLevel: level,
        // Only for a team-scoped level: an Admin sends no `teamIds` at all, so the endpoint leaves
        // any memberships it already has alone (§5.1 shows no Team control for an Admin).
        ...(requiresTeamSelection(level) ? { teamIds: selectedTeamIds } : {}),
      },
      {
        onSuccess: () => {
          notify.success('User added to project')
          handleClose()
        },
        onError: (e) => notify.fromError(e, 'Failed to add user'),
      },
    )
  }

  return (
    <AppModal open={open} onClose={handleClose} title="Add existing user" width={460}>
      <ModalBody className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-ui-sm font-medium text-foreground">User</p>
          <SearchableSelect
            variant="field"
            value={userId ?? ''}
            ariaLabel="Select a workspace user"
            placeholder="Choose a user"
            options={options}
            onChange={(v) => setUserId(v as string)}
          />
          {candidates.length === 0 && (
            <p className="text-ui-xs text-foreground-subtle">
              No eligible workspace users — everyone is already a member.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-ui-sm font-medium text-foreground">Access Level</p>
          <SearchableSelect
            variant="field"
            value={level}
            ariaLabel="Access level"
            options={accessSelectOptions}
            onChange={(v) => setLevel(v as AccessLevel)}
          />
          {/* `grantsAllTeams` + the shared `access.*` keys, not an inline `=== 'admin'`
              and two literals: `user-access-modal.tsx`'s `AddProjectAccess` renders the
              same sentence for the same choice, and §5's closing rule that all three
              journeys "update the same Project access and Team membership source" is
              worth nothing if the two entry points can word that source differently. A
              hand-written level comparison in a second place is also how a granted row
              once read as No Access. */}
          <p className="text-ui-xs text-foreground-subtle">
            {grantsAllTeams(level)
              ? t('access.adminCoversAllTeams')
              : t('access.editorScopedToTeams')}
          </p>
        </div>
        {requiresTeamSelection(level) && (
          <div className="space-y-1.5">
            <p className="text-ui-sm font-medium text-foreground">Teams</p>
            <SearchableSelect
              multiple
              variant="field"
              value={selectedTeamIds}
              ariaLabel="Teams"
              placeholder="No teams"
              searchPlaceholder="Search teams"
              options={teamOptions}
              onChange={(v) => setSelectedTeamIds(v as string[])}
            />
            {teamOptions.length === 0 ? (
              <p className="text-ui-xs text-foreground-subtle">
                This project has no teams yet — add one on its Teams tab.
              </p>
            ) : (
              selectedTeamIds.length === 0 && (
                <p className="text-ui-xs text-warning">
                  Select at least one team — an Editor with no team can&apos;t act on any work in
                  this project yet.
                </p>
              )
            )}
          </div>
        )}
        {/* §5.2 / §2.2: Admin's scope is every team, so there is nothing to pick. */}
        {grantsAllTeams(level) && (
          <div className="space-y-1.5">
            <p className="text-ui-sm font-medium text-foreground">Teams</p>
            <AllTeamsChip />
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!userId || missingTeam || setAccess.isPending}
          onClick={handleAdd}
        >
          {setAccess.isPending && <Loader2 size={12} className="animate-spin" />}
          Add to project
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
