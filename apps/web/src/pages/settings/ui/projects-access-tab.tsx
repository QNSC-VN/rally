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
  useProjectMembers,
  useUpdateProjectAccess,
  useAddProjectMember,
  useProjectTeams,
  useAddTeamMember,
  useRemoveTeamMember,
  useUserTeamMemberships,
  type ProjectMember,
} from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { WarningIndicator } from '@/shared/ui/warning-indicator'
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
  type AccessLevel,
} from '@/shared/config/access-levels'

export function ProjectAccessList({ projectId, isWA }: { projectId: string; isWA: boolean }) {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const updateAccess = useUpdateProjectAccess(projectId)
  const addMember = useAddProjectMember(projectId)
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null)
  const [editorTarget, setEditorTarget] = useState<ProjectMember | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = members.filter((m) =>
    `${m.displayName ?? ''} ${m.email ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  )

  /**
   * The one level-write path on this roster, shared with `EditorTeamsModal` so the
   * POST-vs-PATCH rule below cannot drift between the immediate (Admin) and deferred
   * (Editor) journeys.
   *
   * NULL access_level rows are team-derived: their `id` is a team_members id, and
   * PATCHing it 404s. POST upserts (BE sets the level on the existing row or creates
   * the explicit grant).
   */
  async function writeLevel(member: ProjectMember, level: AccessLevel) {
    if (member.accessLevel) {
      await updateAccess.mutateAsync({ memberId: member.id, accessLevel: level })
    } else {
      await addMember.mutateAsync({ userId: member.userId, accessLevel: level })
    }
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
                <OwnerAvatar name={m.displayName ?? m.email ?? m.userId} size={20} />
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
                  {m.accessLevel && isWA ? (
                    <SearchableSelect
                      variant="cell"
                      value={m.accessLevel}
                      ariaLabel={`Access level for ${m.displayName ?? m.email ?? m.userId}`}
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
                {grantsAllTeams(m.accessLevel) && (
                  <span className="text-ui-xs text-foreground-subtle">{t('access.allTeams')}</span>
                )}
              </div>
              {isWA && (
                <div className="w-8 text-center">
                  <IconButton
                    size="sm"
                    aria-label="Remove access"
                    title="Remove access (No Access)"
                    onClick={() => setRemoveTarget(m)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove project access"
        message={
          removeTarget
            ? `Remove ${removeTarget.displayName ?? removeTarget.email ?? removeTarget.userId} from this project? They will lose all access (No Access) and their Team memberships will be removed.`
            : ''
        }
        confirmLabel="Remove Access"
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
  writeLevel: (member: ProjectMember, level: AccessLevel) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('settings')
  const { data: teams = [] } = useProjectTeams(projectId)
  const teamIds = teams.map((tm) => tm.id)
  const { memberTeamIds, isLoading } = useUserTeamMemberships(teamIds, member.userId)
  const addTeamMember = useAddTeamMember()
  const removeTeamMember = useRemoveTeamMember()
  const [draft, setDraft] = useState<string[] | null>(null)
  const [pending, setPending] = useState(false)
  const label = member.displayName ?? member.email ?? member.userId

  // Seeded from the member's CURRENT teams once they resolve (mockup: `useState(() =>
  // selectedTeamIds.filter(...))`), then owned by the dialog — `null` means "not seeded
  // yet", which is not the same as "seeded empty" and must not be overwritten later.
  const selected = draft ?? memberTeamIds
  const options: SelectOption[] = teams.map((tm) => ({ value: tm.id, label: tm.name }))
  const canSave = !isLoading && (selected.length > 0 || teams.length === 0)

  /**
   * The `team_members` rows go FIRST and the level LAST, and that order is the point of
   * the dialog.
   *
   * Written level-first, one failed `addTeamMember` (a 500, a dropped connection) left the
   * level ALREADY landed with no team rows behind it: an Editor with zero teams — §2.2's
   * "Editor must be assigned to at least one active Team", the exact state this Team step
   * exists to make unreachable, reachable again through a network error instead of a
   * click. In this order the same failure leaves the member at their PREVIOUS level, which
   * is a state §2.2 already permits, plus some team rows that carry delivery meaning
   * anyway (assignment, Team Status, capacity) and that a retry reconciles.
   *
   * Safe to write team rows first because every member this dialog opens over already has
   * an active `project_members` row — the roster lists nothing else, and a NULL level is a
   * team-derived row, not an absent one — so a `team_members` write never precedes the
   * project grant that scopes it. Adds still precede removes for the same reason the level
   * comes last: the member is never momentarily left with no team at all.
   */
  async function handleSave() {
    setPending(true)
    try {
      for (const teamId of selected.filter((id) => !memberTeamIds.includes(id))) {
        await addTeamMember.mutateAsync({ teamId, userId: member.userId })
      }
      for (const teamId of memberTeamIds.filter((id) => !selected.includes(id))) {
        await removeTeamMember.mutateAsync({ teamId, userId: member.userId })
      }
      // `requiresTeamSelection`, never an inline `=== 'editor'`: the shared predicate is
      // the one place a level's team-scoping is decided (`shared/config/access-levels.ts`),
      // and a hand-written level comparison in a second place is what once made a granted
      // row read as No Access.
      if (!requiresTeamSelection(member.accessLevel)) await writeLevel(member, 'editor')
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
 * the BA mockup's single-modal shape. The POST persists the level up front (Stage-5 BE
 * fix); Team membership is a separate write (`team_members`, not `project_members`), so
 * on success this fires one `useAddTeamMember` call per selected team — same hooks and
 * same per-selection call shape as `user-access-modal.tsx`'s `ProjectTeamsField`, just
 * starting from an empty `memberTeamIds` since the user isn't on any team yet.
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
  const addMember = useAddProjectMember(projectId)
  const addTeamMember = useAddTeamMember()
  const [userId, setUserId] = useState<string | null>(null)
  const [level, setLevel] = useState<AccessLevel>('editor')
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])

  // Workspace Admin is company-level only — never a Project member candidate (§2).
  const candidates = wsMembers.filter(
    (m) => !existingIds.has(m.userId) && m.status === 'active' && m.roleSlug !== 'workspace_admin',
  )
  const options: SelectOption[] = candidates.map((m) => ({
    value: m.userId,
    label: m.displayName ?? m.email ?? m.userId,
    searchText: `${m.displayName ?? ''} ${m.email ?? ''}`,
  }))
  const teamOptions: SelectOption[] = teams.map((tm) => ({ value: tm.id, label: tm.name }))
  // §2.2: an Editor must hold at least one Team — enforced, not merely warned (mockup
  // `canAdd`, :235). Relaxed only when the project has no team to choose.
  const missingTeam =
    requiresTeamSelection(level) && teamOptions.length > 0 && selectedTeamIds.length === 0

  function handleClose() {
    setUserId(null)
    setLevel('editor')
    setSelectedTeamIds([])
    onClose()
  }

  function handleAdd() {
    if (!userId) return
    const newUserId = userId
    addMember.mutate(
      { userId: newUserId, accessLevel: level },
      {
        onSuccess: async () => {
          if (requiresTeamSelection(level) && selectedTeamIds.length > 0) {
            await Promise.all(
              selectedTeamIds.map((teamId) =>
                addTeamMember
                  .mutateAsync({ teamId, userId: newUserId })
                  .catch((e) => notify.fromError(e, 'Failed to add to team')),
              ),
            )
          }
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
          disabled={!userId || missingTeam || addMember.isPending || addTeamMember.isPending}
          onClick={handleAdd}
        >
          {(addMember.isPending || addTeamMember.isPending) && (
            <Loader2 size={12} className="animate-spin" />
          )}
          Add to project
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
