/**
 * Per-project Teams tab inside Settings > Workspaces & Projects. Lists the project's
 * teams and lets a Workspace Admin create a team (linked to this project), edit, and
 * deactivate/restore. Mirrors the mockup's Teams tab (Key | Team | Lead | Status |
 * Members | Actions + Add Team).
 *
 * Reuses the team hooks (useCreateTeam / useUpdateTeam / useProjectTeams). Team lead
 * candidates come from the workspace roster. A team cannot be deleted — only
 * deactivated (history preserved), per SRS §488.
 */
import { useState } from 'react'
import { Loader2, Plus, Pencil, Archive, RotateCcw } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useProjectTeams,
  useCreateTeam,
  useUpdateTeam,
  useProjectMembers,
  useSetProjectAccess,
  useTeamMembers,
  type Team,
} from '@/features/teams/api'
import { useWorkspaceMembers, useWorkspaceMemberOptions } from '@/features/workspaces/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { SelectionCheckbox } from '@/shared/ui/selection-checkbox'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FormField } from '@/shared/ui/form-field'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { notify } from '@/shared/lib/toast'
import {
  teamMemberAccessOptions,
  type AccessLevel,
  type TeamMemberAccessLevel,
} from '@/shared/config/access-levels'

export function ProjectTeamsTab({
  projectId,
  isWA,
  onOpenTeam,
}: {
  projectId: string
  isWA: boolean
  /** Row click bubbles to the panel, which shows the team detail in the whole
   *  detail pane (mockup parity — replaces the project header + tabs, so the
   *  team's own header is never stacked under the project's). */
  onOpenTeam: (team: Team) => void
}) {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: teams = [], isLoading } = useProjectTeams(projectId)
  /**
   * The Lead's name/avatar comes from the PICKER feed, not the administrative roster.
   *
   * This tab is gated `project:view`, so an EDITOR reaches it — and the administrative roster is now
   * `workspace:view` (Workspace Admin only), because it carries `phone`, `lastLoginAt` and the role ids
   * (RBE-07). Reading it here would 403 for every non-WA and silently degrade every Lead to `--`: no
   * crash, no error, just a column that quietly stops working for the level that uses it most.
   */
  const { data: wsMembers = [] } = useWorkspaceMemberOptions(workspaceId)
  const [editing, setEditing] = useState<Team | null>(null)
  const [creating, setCreating] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<Team | null>(null)
  const updateTeam = useUpdateTeam(deactivateTarget?.id ?? editing?.id ?? '')

  function confirmDeactivate() {
    if (!deactivateTarget) return
    updateTeam.mutate(
      { status: 'archived' },
      {
        onSuccess: () => {
          notify.success(`Deactivated ${deactivateTarget.name}`)
          setDeactivateTarget(null)
        },
        onError: (e) => notify.fromError(e, 'Failed to deactivate team'),
      },
    )
  }

  return (
    <>
      {isWA && (
        <div className="mb-3 flex justify-end">
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus size={14} /> Add team
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-ui-md text-foreground-subtle">
          <Loader2 size={14} className="animate-spin" /> Loading teams…
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-8 text-center text-ui-md text-foreground-subtle">
          No teams linked to this project yet.
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle">
          <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
            <span className="w-20">Key</span>
            <span className="flex-1">Team</span>
            <span className="w-28">Lead</span>
            <span className="w-24">Status</span>
            <span className="w-20 text-center">Members</span>
            {isWA && <span className="w-20 text-center">Actions</span>}
          </div>
          {teams.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenTeam(t)}
              onKeyDown={(e) => e.key === 'Enter' && onOpenTeam(t)}
              className="flex cursor-pointer items-center gap-2 border-b border-border-subtle px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-hover"
            >
              <span className="w-20 font-mono text-ui-xs text-foreground-subtle">{t.key}</span>
              <span className="flex-1 truncate text-ui-sm font-medium text-foreground">
                {t.name}
              </span>
              <span className="flex w-28 min-w-0 items-center gap-1.5">
                {(() => {
                  const lead = wsMembers.find((m) => m.userId === t.leadId)
                  const name = lead?.displayName ?? lead?.email ?? '--'
                  return (
                    <>
                      <OwnerAvatar name={name} size={16} />
                      <span className="truncate text-ui-xs text-foreground-subtle">{name}</span>
                    </>
                  )
                })()}
              </span>
              <span className="w-24 text-ui-xs text-foreground-subtle capitalize">
                {t.status === 'active' ? 'Active' : 'Deactivated'}
              </span>
              <span className="w-20 text-center text-ui-sm text-foreground-subtle">
                {t.memberCount ?? 0}
              </span>
              {isWA && (
                /* stopPropagation: the row opens detail; the icon acts alone. */
                <span
                  className="flex w-20 justify-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <IconButton
                    size="sm"
                    aria-label="Edit team"
                    title="Edit"
                    onClick={() => setEditing(t)}
                  >
                    <Pencil size={13} />
                  </IconButton>
                  {t.status === 'active' ? (
                    <IconButton
                      size="sm"
                      aria-label="Deactivate team"
                      title="Deactivate"
                      onClick={() => setDeactivateTarget(t)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Archive size={13} />
                    </IconButton>
                  ) : (
                    <RestoreButton teamId={t.id} name={t.name} />
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate team"
        message={
          deactivateTarget
            ? `Deactivate ${deactivateTarget.name}? It becomes unavailable for new membership. Delivery history is preserved.`
            : ''
        }
        confirmLabel="Deactivate"
        destructive
        pending={updateTeam.isPending}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />

      {(creating || editing) && (
        <TeamFormModal
          projectId={projectId}
          workspaceId={workspaceId}
          team={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

/** Restore needs its own hook instance (per-teamId). Kept tiny on purpose. */
function RestoreButton({ teamId, name }: { teamId: string; name: string }) {
  const updateTeam = useUpdateTeam(teamId)
  return (
    <IconButton
      size="sm"
      aria-label="Restore team"
      title="Restore"
      onClick={() =>
        updateTeam.mutate(
          { status: 'active' },
          {
            onSuccess: () => notify.success(`Restored ${name}`),
            onError: (e) => notify.fromError(e, 'Failed to restore team'),
          },
        )
      }
    >
      <RotateCcw size={13} />
    </IconButton>
  )
}

/** Team DETAIL view (mockup parity): fields grid + member roster + WA Edit.
 *  Reached by clicking a team row OR a team node in the tree; Back returns to
 *  whatever surface opened it. Self-contained on edit (renders TeamFormModal). */
export function TeamDetail({
  projectId,
  team,
  workspaceId,
  isWA,
}: {
  projectId: string
  team: Team
  workspaceId: string | undefined
  isWA: boolean
}) {
  const { data: members = [], isLoading } = useTeamMembers(team.id)
  // Display-only, so the picker feed — see the note on the row above.
  const { data: wsMembers = [] } = useWorkspaceMemberOptions(workspaceId)
  const [editing, setEditing] = useState(false)
  const leadName =
    wsMembers.find((m) => m.userId === team.leadId)?.displayName ??
    wsMembers.find((m) => m.userId === team.leadId)?.email

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-ui-lg font-semibold text-foreground">{team.name}</h3>
          <p className="text-ui-xs text-foreground-subtle">{team.key}</p>
        </div>
        {isWA && (
          <IconButton
            size="sm"
            aria-label="Edit team"
            title="Edit team"
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
          </IconButton>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4">
        {(
          [
            ['Team key', team.key],
            ['Status', team.status === 'active' ? 'Active' : 'Deactivated'],
            ['Team lead', leadName ?? '--'],
            ['Members', String(members.length)],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <p className="text-ui-xs font-medium tracking-wide text-foreground-subtle uppercase">
              {label}
            </p>
            <p className="mt-0.5 text-ui-sm text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <p className="mb-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
        Team members
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-ui-sm text-foreground-subtle">
          <Loader2 size={13} className="animate-spin" /> Loading members…
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-6 text-center text-ui-sm text-foreground-subtle">
          No members in this team yet.
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0"
            >
              <OwnerAvatar name={m.displayName ?? m.email ?? m.userId} size={20} />
              <span className="truncate text-ui-sm font-medium text-foreground">
                {m.displayName ?? m.email ?? '--'}
              </span>
              {m.email && (
                <span className="ml-auto truncate text-ui-xs text-foreground-subtle">
                  {m.email}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TeamFormModal
          projectId={projectId}
          workspaceId={workspaceId}
          team={team}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}

/**
 * Create or edit a team — mockup parity: NO project picker. The tab's own project IS
 * the context: create links the team to exactly this project (the API's ≥1-project
 * rule is satisfied by construction); edit sends no projectIds at all, so existing
 * links are untouched. (Cross-project links are managed from each project's own
 * Teams tab, exactly like the mockup.)
 */
function TeamFormModal({
  projectId,
  workspaceId,
  team,
  onClose,
}: {
  projectId: string
  workspaceId: string | undefined
  team: Team | null
  onClose: () => void
}) {
  // The administrative roster ON PURPOSE: this modal filters `roleSlug !== 'workspace_admin'` out of
  // the eligible list (§2.1 — a WA is never a Team member), and `roleSlug` exists only on that feed.
  // Creating or editing a Team is a Workspace Admin action anyway, so the `workspace:view` gate costs
  // nothing here. Do not "align" this with the two display-only lookups above.
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId)
  // Existing project members — only needed on create, to sync access for selected members.
  const { data: projectMembers = [] } = useProjectMembers(team ? undefined : projectId)
  const createTeam = useCreateTeam()
  const updateTeam = useUpdateTeam(team?.id ?? '')
  const setAccess = useSetProjectAccess(projectId)
  const [name, setName] = useState(team?.name ?? '')
  const [key, setKey] = useState(team?.key ?? '')
  const [leadId, setLeadId] = useState<string | null>(team?.leadId ?? null)
  // Per-user access map: presence of a userId = included; its value = the level that
  // row gets. Replaces the old (memberUserIds[] + one shared memberLevel) shape, which
  // could only add everyone at the SAME level — the mockup's Members & Access table lets
  // Priya Nair land as Admin while everyone else stays Editor in the same action.
  /**
   * Team members are Admin or Editor only — never Viewer (SRS §5.3, and Rally removes team
   * membership on demotion to viewer). Deliberately NOT `AccessLevel`: see
   * `TEAM_MEMBER_ACCESS_LEVELS`.
   */
  const [memberAccess, setMemberAccess] = useState<Record<string, TeamMemberAccessLevel>>({})

  // Workspace Admin is company-level only — not a Team lead or member candidate (§2).
  const eligible = wsMembers.filter(
    (m) => m.status === 'active' && m.roleSlug !== 'workspace_admin',
  )
  const leadOptions: SelectOption[] = eligible.map((m) => ({
    value: m.userId,
    label: m.displayName ?? m.email ?? m.userId,
  }))
  const valid = name.trim().length >= 2 && /^[A-Z][A-Z0-9]{1,9}$/.test(key)

  /** Toggling a row includes/excludes it. A newly-checked row defaults to its CURRENT
   *  project access level (mockup: Priya Nair, already Admin, shows "Admin" once
   *  checked) or 'editor' when it has none yet — never a blanket shared default. */
  function toggleMemberRow(userId: string, currentLevel: AccessLevel | null) {
    setMemberAccess((prev) => {
      const next = { ...prev }
      if (userId in next) {
        delete next[userId]
      } else {
        // A Viewer joining a team is PROMOTED to Editor, not carried across as a Viewer. Team
        // membership only means anything for someone who can write — it is the boundary an Editor's
        // writes are measured against — so "read-only team member" is not a state worth having.
        // Rally does the same from the same premise: its Team Member checkbox auto-promotes to
        // Editor, and demoting to Viewer removes team membership. §5.3 states the rule as "only
        // Admin and Editor are Team-member choices".
        next[userId] = currentLevel === 'admin' ? 'admin' : 'editor'
      }
      return next
    })
  }

  function setMemberRowLevel(userId: string, level: TeamMemberAccessLevel) {
    setMemberAccess((prev) => ({ ...prev, [userId]: level }))
  }

  /**
   * P4-RBAC-010 / §5.3: setting up a team assigns each selected member their Project access — each at
   * ITS OWN level, per `memberAccess`. A team created here is linked to THIS project only (no
   * picker), so this project is the only one to sync.
   *
   * The THIRD §5 journey, and it reaches the SAME combined writer as the other two (AC-9: "All three
   * journeys update the same Project access and Team membership source"). It used to branch between
   * `POST /projects/{id}/members` and `PATCH /projects/{id}/members/{memberId}` — a NULL
   * `access_level` row is team-derived, so its `id` is a `team_members` id and PATCHing it 404'd,
   * which surfaced as "Failed to create team" over a half-write. One upserting endpoint removes the
   * branch and the failure mode with it.
   *
   * No `teamIds` here, deliberately: `POST /v1/teams` has already written the roster rows for
   * `memberUserIds` and implied a level for each (`teamRosterAccessLevel`), so an Editor landing in
   * this loop already satisfies §2.2 — this call is only correcting the LEVEL, and sending a team set
   * would let a level correction silently reshape the membership the team creation just established.
   */
  async function syncMemberAccess() {
    for (const [uid, level] of Object.entries(memberAccess)) {
      const existing = projectMembers.find((pm) => pm.userId === uid)
      if (existing?.accessLevel === level) continue
      await setAccess.mutateAsync({ userId: uid, accessLevel: level })
    }
  }

  async function handleSave() {
    if (!valid) return
    if (team) {
      // No projectIds (links are not this modal's concern) and no key (immutable
      // after create) in the PATCH.
      updateTeam.mutate(
        { name: name.trim(), leadId: leadId ?? null },
        {
          onSuccess: () => {
            notify.success('Team updated')
            onClose()
          },
          onError: (e) => notify.fromError(e, 'Failed to update team'),
        },
      )
      return
    }
    try {
      await createTeam.mutateAsync({
        workspaceId: workspaceId ?? '',
        name: name.trim(),
        key,
        leadId: leadId ?? null,
        // No project picker (mockup parity): the tab's project IS the context.
        projectIds: [projectId],
        memberUserIds: Object.keys(memberAccess),
      })
      await syncMemberAccess()
      notify.success('Team created')
      onClose()
    } catch (e) {
      notify.fromError(e, 'Failed to create team')
    }
  }

  const pending = createTeam.isPending || updateTeam.isPending || setAccess.isPending

  return (
    <AppModal open onClose={onClose} title={team ? 'Edit team' : 'Create team'} width={460}>
      <ModalBody className="space-y-4">
        <FormField label="Team name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Core Platform"
          />
        </FormField>
        <FormField label="Team key" hint="2–10 uppercase letters/numbers" required>
          <Input
            value={key}
            disabled={!!team}
            onChange={(e) =>
              setKey(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 10),
              )
            }
            placeholder="CP"
            className="font-mono"
          />
        </FormField>
        <FormField label="Team lead">
          <SearchableSelect
            variant="field"
            value={leadId ?? ''}
            ariaLabel="Team lead"
            placeholder="Unassigned"
            options={leadOptions}
            onChange={(v) => setLeadId(v as string | null)}
          />
        </FormField>
        {!team && eligible.length > 0 && (
          <FormField
            label={
              <div className="flex items-center justify-between gap-2">
                <span>Members & access</span>
                <span className="text-ui-xs font-normal text-foreground-subtle">
                  Admin joins All Teams; Editor joins this Team.
                </span>
              </div>
            }
          >
            <div className="rounded-lg border border-border-subtle">
              <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-3 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
                <span className="w-5" />
                <span className="flex-1">User</span>
                <span className="w-20 text-center">Current</span>
                <span className="w-32 text-center">New access</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {eligible.map((m) => {
                  const currentLevel =
                    projectMembers.find((pm) => pm.userId === m.userId)?.accessLevel ?? null
                  const checked = m.userId in memberAccess
                  const label = m.displayName ?? m.email ?? m.userId
                  return (
                    <div
                      key={m.userId}
                      className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0"
                    >
                      <span className="flex w-5 justify-center">
                        <SelectionCheckbox
                          checked={checked}
                          onChange={() => toggleMemberRow(m.userId, currentLevel)}
                          ariaLabel={`Add ${label} to this team`}
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <OwnerAvatar name={label} size={20} />
                        <span className="truncate text-ui-sm text-foreground">{label}</span>
                      </span>
                      <span className="w-20 text-center text-ui-xs text-foreground-subtle">
                        {currentLevel ? (
                          <span className="capitalize">{currentLevel}</span>
                        ) : (
                          'No Access'
                        )}
                      </span>
                      <span className="w-32">
                        {checked ? (
                          <SearchableSelect
                            variant="field"
                            dense
                            value={memberAccess[m.userId]}
                            ariaLabel={`Access level for ${label}`}
                            options={teamMemberAccessOptions}
                            onChange={(v) =>
                              setMemberRowLevel(m.userId, v as TeamMemberAccessLevel)
                            }
                          />
                        ) : (
                          <span className="block text-center text-ui-xs text-foreground-subtle opacity-60">
                            Not added
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </FormField>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!valid || pending} onClick={handleSave}>
          {pending && <Loader2 size={12} className="animate-spin" />}
          {team ? 'Save' : 'Create team'}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
