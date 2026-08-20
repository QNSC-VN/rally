/**
 * One team's member roster, with the Workspace-Admin-aware add/remove controls.
 *
 * Extracted from `project-teams-tab.tsx`'s `TeamDetail`, where the roster was READ-ONLY: the tab
 * could create a team with members and edit its name/lead, and there was no way to add or remove a
 * member on an EXISTING team from anywhere in the SPA — `useAddTeamMember` / `useRemoveTeamMember`
 * had no caller at all, while `POST`/`DELETE /v1/teams/{id}/members` were live and gated
 * `teams:manage_members`. The BA's team-membership ruling makes those two actions the whole feature
 * ("can be manually added to / removed from one or more ACTIVE Teams … Removing them from a Team
 * removes only that membership"), so they had to exist somewhere; this is the surface that already
 * shows the roster they change.
 *
 * Three rules the ruling states, and where each one lives here:
 *
 *  - **NEVER automatic.** The add is one explicit pick per person. There is no enrol-all, no default
 *    selection, and nothing derives a membership from a role.
 *  - **Badge, never a level.** A Workspace Admin row renders {@link WorkspaceAdminBadge}. Team
 *    membership is OPERATIONAL scope only, so this surface writes `team_members` and NOTHING in
 *    `project_members` — which is why the roster shows no access level for anyone, rather than
 *    special-casing one.
 *  - **ACTIVE teams only.** A deactivated team offers no add control: `status` is what the ruling
 *    scopes membership to, and the team picker, capacity eligibility and every assignment surface
 *    already hide an archived team, so growing one is a membership nobody can use.
 */
import { useState } from 'react'
import { Loader2, UserMinus, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  useAddTeamMember,
  useRemoveTeamMember,
  useTeamMembers,
  type Team,
  type TeamMember,
} from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { memberSelectOption, OwnerAvatar } from '@/shared/ui/owner-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { WorkspaceAdminBadge } from '@/shared/ui/workspace-admin-badge'
import { notify } from '@/shared/lib/toast'
import { EMPTY_VALUE } from '@/shared/lib/utils'

/** The label a roster row and its removal confirmation must BOTH use — see `memberLabel` in
 *  `projects-access-tab.tsx` for why a computed confirmation string cannot be spelled twice. */
function teamMemberLabel(m: TeamMember): string {
  return m.displayName ?? m.email ?? m.userId
}

export function TeamMemberRoster({
  team,
  workspaceId,
  isWA,
}: {
  team: Team
  workspaceId: string | undefined
  isWA: boolean
}) {
  const { t } = useTranslation('settings')
  const { data: members = [], isLoading } = useTeamMembers(team.id)
  const removeMember = useRemoveTeamMember(team.id)
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const canManage = isWA && team.status === 'active'

  function confirmRemove() {
    if (!removeTarget) return
    const name = teamMemberLabel(removeTarget)
    removeMember.mutate(removeTarget.userId, {
      onSuccess: () => {
        notify.success(t('teams.removeMemberRemoved', { name, team: team.name }))
        setRemoveTarget(null)
      },
      onError: (e) => notify.fromError(e, t('teams.removeMemberError')),
    })
  }

  return (
    <>
      <div className="mb-2 flex items-end justify-between gap-3">
        <p className="text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
          {t('teams.members')}
        </p>
        {/* Mounted only while the surface can write: it reads the ADMINISTRATIVE workspace roster
            (for `roleSlug`, so a candidate can carry its badge), which 403s for anyone else. */}
        {canManage && (
          <AddTeamMemberControl
            team={team}
            workspaceId={workspaceId}
            memberUserIds={members.map((m) => m.userId)}
          />
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-ui-sm text-foreground-subtle">
          <Loader2 size={13} className="animate-spin" /> {t('teams.loadingMembers')}
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-6 text-center text-ui-sm text-foreground-subtle">
          {t('teams.noMembers')}
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0"
            >
              <OwnerAvatar name={teamMemberLabel(m)} size={20} />
              <span className="truncate text-ui-sm font-medium text-foreground">
                {m.displayName ?? m.email ?? EMPTY_VALUE}
              </span>
              {/* The ruling's badge requirement, in the TEAM member view. It sits beside the name
                  rather than in an access column because this roster has none — team membership
                  writes no `project_members` row for anyone. */}
              {m.isWorkspaceAdmin && <WorkspaceAdminBadge />}
              {m.email && (
                <span className="ml-auto truncate text-ui-xs text-foreground-subtle">
                  {m.email}
                </span>
              )}
              {canManage && (
                <IconButton
                  size="sm"
                  aria-label={`${t('teams.removeMember')}: ${teamMemberLabel(m)}`}
                  title={t('teams.removeMember')}
                  onClick={() => setRemoveTarget(m)}
                  className="ml-2 shrink-0 text-destructive hover:text-destructive"
                >
                  <UserMinus size={13} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}

      {/*
        NAMED, not TYPED. `ConfirmDialog`'s typed gate is reserved for the destructive actions that
        no equal-and-opposite click undoes — removing PROJECT access (which also deletes team rows)
        and deactivating a Team (a multi-user action). Removing one team membership is reversed by
        the Add control directly above it, and the ruling is explicit that nothing else moves with
        it, so the message says exactly that instead of asking for the name to be retyped.
      */}
      <ConfirmDialog
        open={!!removeTarget}
        title={t('teams.removeMemberTitle')}
        message={
          removeTarget
            ? t('teams.removeMemberConfirm', {
                name: teamMemberLabel(removeTarget),
                team: team.name,
              })
            : ''
        }
        confirmLabel={t('teams.removeMemberConfirmLabel')}
        destructive
        pending={removeMember.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  )
}

/**
 * The ADD half — one pick, one write, no default selection.
 *
 * Candidates are every ACTIVE workspace member not already on the roster, Workspace Admins
 * INCLUDED. That inclusion is the reversed half of §2.1 (see `project-teams-tab.tsx`). A Workspace
 * Admin candidate carries the same shield glyph the badge uses and matches a search for `Workspace
 * Admin`, so the person choosing can tell before the pick that this grants operational scope and no
 * project access level.
 */
function AddTeamMemberControl({
  team,
  workspaceId,
  memberUserIds,
}: {
  team: Team
  workspaceId: string | undefined
  memberUserIds: readonly string[]
}) {
  const { t } = useTranslation('settings')
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId)
  const addMember = useAddTeamMember(team.id)
  const existing = new Set(memberUserIds)
  const adminLabel = t('access.workspaceAdmin')
  const candidates: SelectOption[] = wsMembers
    .filter((m) => m.status === 'active' && !existing.has(m.userId))
    .map((m) => {
      const isWorkspaceAdmin = m.roleSlug === 'workspace_admin'
      // Every candidate gets the avatar; a Workspace Admin additionally MATCHES the badge word, so
      // searching "Workspace Admin" finds them. Previously only they carried a glyph — a shield — which
      // made an ordinary member look like a row with something missing rather than a different kind.
      return memberSelectOption(m, {
        extraSearch: isWorkspaceAdmin ? adminLabel : undefined,
      })
    })

  if (candidates.length === 0) {
    return <p className="text-ui-xs text-foreground-subtle">{t('teams.addMemberNoCandidates')}</p>
  }

  function add(userId: string) {
    if (!userId) return
    const name = candidates.find((c) => c.value === userId)?.label ?? userId
    addMember.mutate(userId, {
      onSuccess: () => notify.success(t('teams.addMemberAdded', { name, team: team.name })),
      onError: (e) => notify.fromError(e, t('teams.addMemberError')),
    })
  }

  return (
    <div className="flex w-64 items-center gap-2">
      {addMember.isPending ? (
        <Loader2 size={13} className="animate-spin text-foreground-subtle" />
      ) : (
        <UserPlus size={13} className="shrink-0 text-foreground-subtle" />
      )}
      {/* `value=''` always: this is an ACTION, not a field — the pick fires the write and the
          control returns to its placeholder, so it never claims to hold a current value. */}
      <SearchableSelect
        variant="field"
        dense
        value=""
        readOnly={addMember.isPending}
        ariaLabel={t('teams.addMember')}
        placeholder={t('teams.addMemberPlaceholder')}
        searchPlaceholder={t('teams.addMemberSearch')}
        options={candidates}
        onChange={(v) => add(v as string)}
      />
    </div>
  )
}
