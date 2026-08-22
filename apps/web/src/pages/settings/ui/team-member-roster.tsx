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
import { useMemo, useState } from 'react'
import { Loader2, UserMinus, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  useAddTeamMember,
  useProjectMembers,
  useRemoveTeamMember,
  useTeamMembers,
  type Team,
  type TeamMember,
} from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { Button } from '@/shared/ui/button'
import { SelectionModal, type SelectionItem } from '@/shared/ui/selection-modal'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
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
  projectId,
  isWA,
}: {
  team: Team
  workspaceId: string | undefined
  /** The project this roster is being managed FROM — the scope its add candidates come from. */
  projectId: string
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
            projectId={projectId}
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
 * The ADD half — an `Add` button and a modal, and candidates scoped to THIS PROJECT.
 *
 * Both halves are BA report 2026-08-21. It was an inline popover over every active WORKSPACE member,
 * so on a project with no members of its own the picker still offered all four workspace users and
 * "users who do not belong to Project X are exposed as Team member candidates". A team roster row is
 * project-scoped work — RBE-06 even GRANTS project access from it — so offering an outsider was the
 * picker promising something the project's own access list never said.
 *
 * WHO IS ELIGIBLE: active users holding access to this project, plus active Workspace Admins, minus
 * anyone already on the roster. The Workspace Admins are in because their authority IS the
 * workspace-wide grant (§2.1 keeps them off `project_members`, migration 0118 deletes such rows), so a
 * project-membership test would exclude exactly the principals the 2026-08-20 Workspace-Admin-on-a-Team
 * feature exists for — and the same BA report shows them as a row on that project's own Users &
 * Permissions list. They keep the badge word in their search text, so the reader can tell before the
 * pick that this grants operational scope and no project access level.
 *
 * `SelectionModal` rather than a hand-rolled dialog: it already owns the search box, the disabled-row
 * treatment and the empty state the report asks for. Its multi-select is a bonus the inline control
 * could not offer — staffing a team is rarely one person — and each pick is still one explicit write.
 *
 * The SERVER refuses an ineligible user independently (`TEAM_MEMBER_NOT_PROJECT_MEMBER`), which is the
 * half a narrowed picker cannot provide.
 */
function AddTeamMemberControl({
  team,
  workspaceId,
  projectId,
  memberUserIds,
}: {
  team: Team
  workspaceId: string | undefined
  projectId: string
  memberUserIds: readonly string[]
}) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const { data: projectMembers = [] } = useProjectMembers(projectId)
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId)
  const addMember = useAddTeamMember(team.id)
  const adminLabel = t('access.workspaceAdmin')

  const candidates: SelectionItem[] = useMemo(() => {
    // Built INSIDE the memo: a Set constructed in the body is a new reference every render, so it
    // would defeat the memo it is a dependency of.
    const existing = new Set(memberUserIds)
    const rows = new Map<string, SelectionItem>()
    for (const m of projectMembers) {
      if (m.status !== 'active' || existing.has(m.userId)) continue
      rows.set(m.userId, {
        id: m.userId,
        name: m.displayName ?? m.email ?? m.userId,
        icon: <OwnerAvatar name={m.displayName ?? m.email ?? m.userId} size={16} />,
        meta: m.email ?? undefined,
      })
    }
    for (const a of wsMembers) {
      if (a.roleSlug !== 'workspace_admin' || a.status !== 'active') continue
      if (existing.has(a.userId)) continue
      const name = a.displayName ?? a.email ?? a.userId
      rows.set(a.userId, {
        id: a.userId,
        name,
        icon: <OwnerAvatar name={name} size={16} />,
        // The badge word, so the reader sees WHY this person is eligible without a project row.
        meta: adminLabel,
      })
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [projectMembers, wsMembers, memberUserIds, adminLabel])

  async function addAll(userIds: string[]) {
    // Sequential, not `Promise.all`: each add re-reads the roster and may grant project access
    // (RBE-06), and a failure part-way must leave the successful ones written rather than racing.
    for (const userId of userIds) {
      await addMember.mutateAsync(userId)
    }
    notify.success(t('teams.addMemberAdded', { name: `${userIds.length}`, team: team.name }))
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <UserPlus size={13} /> {t('teams.addMember')}
      </Button>
      {open && (
        <SelectionModal
          open={open}
          onClose={() => setOpen(false)}
          title={t('teams.addMemberModalTitle', { team: team.name })}
          searchPlaceholder={t('teams.addMemberSearch')}
          confirmLabel={t('teams.addMemberConfirm')}
          items={candidates}
          selectedIds={[]}
          onSave={addAll}
        />
      )}
    </>
  )
}
