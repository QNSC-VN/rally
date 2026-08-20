/**
 * User Access modal — User-Centric Journey (SRS §5.1 / P4-RBAC-009).
 * Opens from the Members tab. Two tabs:
 *   - General: read-only identity (name/email/avatar are IdP/Profile-owned, same
 *     rule as the Members grid's `user` column) plus the one field that IS
 *     editable per-member today — Status (active/suspended), reusing the exact
 *     `useUpdateMember` + confirm-before-suspend behaviour the Members grid uses
 *     (P4-SET-07).
 *   - Project Access: a Workspace Admin ASSIGNS / CHANGES / REMOVES the user's
 *     per-Project access (admin / editor / No Access) and, for an Editor, their
 *     Teams — the same write the Project-centric and Team journeys make, so all
 *     three stay synchronized (P4-RBAC-010/011, AC-9). That write is now ONE
 *     request, `POST /v1/projects/{id}/members` with `accessLevel` AND `teamIds`
 *     together, because §2.2's "an Editor must be assigned to at least one active
 *     Team" is only enforceable server-side when both halves arrive together
 *     (PRJ-08). It used to be a level write followed by one `POST
 *     /teams/{id}/members` per team.
 *
 * **Project Access is a DRAFT.** Nothing is written until `Review Changes` →
 * `Confirm & Save`, because §5.1's journey names those two steps literally:
 * "Choose Admin / Editor -> Choose Teams only when level is Editor -> Review
 * Changes -> Confirm & Save" (:125-135), and the mockup implements them as a
 * `draft` + a review dialog + a `save()` (`SettingsPage.tsx`:293-294, 434,
 * 438-452). Every control here used to commit on change, so a mis-click on
 * Access Level was already persisted (and had already invalidated the target
 * user's permission cache) with nothing to review and nothing to abandon — and
 * the two §5 journeys had different transactional semantics, which §5's closing
 * sentence ("All three journeys update the same Project access and Team
 * membership source") exists to prevent.
 *
 * The General tab's Status deliberately stays immediate: it is a
 * `workspace_members` field with its own typed confirmation (P4-SET-07), not
 * Project access, and §5.1's review step is scoped to the latter.
 *
 * **A WORKSPACE ADMIN target is read-only here** (§2.1). A Workspace Admin's
 * authority IS the workspace-wide grant; §2.1 gives it every project outright and
 * lists no per-Project row for it, so `project_members.access_level` has nothing to
 * say about one. This surface nonetheless offered the full editor: an `Access Level`
 * picker, `+ Add project access` and `Remove access` for a principal the model says
 * cannot hold either state — so the one write it invited (a `project_members` row on
 * a WA) was a row §2.1 forbids, and the one it implied (Remove) promised a
 * revocation that changes nothing, because `workspace:*` is what actually grants the
 * access. The General tab was already read-only for a WA (`statusLocked`); only
 * Project Access was not.
 *
 * Detected from `member.roleSlug`, deliberately NOT from an absent access level:
 * `AccessService.getProjectAccessLevel` returns `null` for a Workspace Admin AND for
 * No Access, and every caller reads that `null` as "WA, allowed" (see
 * `ProjectsService.listProjectMembers`). Inferring WA-ness from it here would make
 * this screen and that guard disagree about what `null` means.
 *
 * Existing rows still RENDER, read-only, rather than being hidden. A WA that
 * predates its elevation can legitimately carry `project_members` rows, and hiding
 * them would leave the one screen that reports a user's access silently incomplete.
 *
 * **Admin shows `All Teams`, never a Team picker** (§5.1 :141-143, §2.2 :51).
 * The picker used to render for Admin as well, so a Workspace Admin was invited
 * to build a team scope for a level that has none — `grantsAllTeams` means an
 * Admin covers every team by definition, so those rows changed nothing.
 * Promoting an Editor to Admin therefore sends no `teamIds` at all, and so
 * REMOVES none either: the existing memberships carry delivery meaning
 * (assignment, Team Status, capacity) and keeping them makes a later demotion
 * lossless. Only Remove clears them (§5.2).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjects } from '@/features/projects/api'
import { useProjectMembers, useProjectTeams, useUserTeamMemberships } from '@/features/teams/api'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateMember, type WorkspaceMember } from '@/features/workspaces/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { PERMISSION } from '@/shared/config/permissions'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { teamSelectOption } from '@/shared/ui/team-cell'
import { KeyChip } from '@/shared/ui/key-chip'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { IconButton } from '@/shared/ui/icon-button'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { notify } from '@/shared/lib/toast'
import { AllTeamsChip } from '@/shared/ui/all-teams-chip'
import {
  accessSelectOptions,
  grantsAllTeams,
  requiresTeamSelection,
  type AccessLevel,
} from '@/shared/config/access-levels'

// "Remove Access" is a permanent status='removed' transition (SRS §6.3: an
// inline status value, not a row action button) — same three values, same
// typed-confirmation rule, as the Members grid's inline Status cell.
const GENERAL_STATUS_OPTIONS: SelectOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Deactive' },
  { value: 'removed', label: 'Remove Access' },
]

type MemberStatus = 'active' | 'suspended' | 'removed'

type ModalTab = 'general' | 'access'

/** One team of a project, as the rows report it up for the review summary. */
interface TeamRef {
  id: string
  name: string
}

/**
 * The SERVER's current answer for one project — what the draft is diffed against
 * on save. Reported by whichever child owns that project's queries.
 */
interface ProjectBaseline {
  /** An active `project_members` row exists (any level, including NULL). */
  hasAccess: boolean
  level: AccessLevel | null
  /** The user's active team memberships among this project's teams. */
  teamIds: string[]
  /** The project's teams, for the review summary and the "no team to pick" case. */
  teams: TeamRef[]
}

/**
 * The pending edit for one project row — ONLY what the user actually touched.
 * `level: null` = a team-derived row untouched.
 *
 * `teamIds` is OPTIONAL, and that is the point. It used to be materialised the moment any part of the
 * row was edited, from `baselines[projectId]?.teamIds ?? []` — but the baseline's team memberships
 * arrive from their own query, so choosing `Editor` before `/v1/teams/{id}/members` resolved froze
 * `[]` into the draft. A draft existing then SHADOWS the baseline, so the real memberships could never
 * reach it: §2.2's "an Editor needs a Team" guard stayed true forever, `Review Changes` was disabled
 * permanently, and the Team picker showed the user's own team unchecked. The only way out was to close
 * and reopen the modal. Reproduced 2 runs in 8; raising the test's timeout to 5s did not help, which is
 * what proved it was frozen state rather than a slow render.
 *
 * `undefined` therefore means "not touched — resolve against the baseline when it arrives", the same
 * absent-versus-empty distinction this repo relies on elsewhere (a capacity plan's window, an
 * allocation's value). {@link resolveAccess} is the single place that resolution happens.
 */
interface AccessDraft {
  level: AccessLevel | null
  teamIds?: string[]
}

/** A draft resolved against its baseline: what a row renders, and what a save would write. */
interface ResolvedAccess {
  level: AccessLevel | null
  teamIds: string[]
}

/**
 * Resolve a draft against its baseline. The ONE home for that rule.
 *
 * It was previously inlined twice — in `effective()` and again in the `changes` builder — with the
 * same `?? []` fallback written out both times. Two copies of "what does this row currently say" is
 * how the row a reader sees and the change a save writes drift apart.
 */
function resolveAccess(
  draft: AccessDraft | undefined,
  base: ProjectBaseline | undefined,
): ResolvedAccess {
  return {
    level: draft ? draft.level : (base?.level ?? null),
    teamIds: draft?.teamIds ?? base?.teamIds ?? [],
  }
}

/** One row of the `Review Changes` summary, and one unit of work for `Confirm & Save`. */
type PendingChange =
  | { kind: 'remove'; projectId: string; label: string }
  | {
      kind: 'grant' | 'update'
      projectId: string
      label: string
      level: AccessLevel | null
      levelChanged: boolean
      teamIds: string[]
      teamNames: string[]
      /** No team exists to satisfy §2.2's "Editor needs a Team" — see `isBlocked`. */
      projectHasNoTeams: boolean
    }

/** An Editor with no team is invalid (§2.2) — unless the project has no team to give. */
function isBlocked(change: PendingChange): boolean {
  if (change.kind === 'remove') return false
  return (
    requiresTeamSelection(change.level) && change.teamIds.length === 0 && !change.projectHasNoTeams
  )
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}

export function UserAccessModal({
  member,
  workspaceId,
  onClose,
}: {
  member: WorkspaceMember
  workspaceId: string
  onClose: () => void
}) {
  const { t } = useTranslation('settings')
  const { hasPermission, user } = useAuthStore()
  const isWA = hasPermission(PERMISSION.WORKSPACE_ALL)
  /**
   * The TARGET is a Workspace Admin — §2.1 gives it every project through the
   * workspace-wide grant and defines no per-Project row for it, so there is nothing
   * on this tab to set. Read the role slug, never an absent level: see the docblock.
   */
  const targetIsWorkspaceAdmin = member.roleSlug === 'workspace_admin'
  /** The actor may edit project access AND the target is allowed to hold it. */
  const canEditAccess = isWA && !targetIsWorkspaceAdmin
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<ModalTab>('general')
  const { data: projects = [], isLoading } = useProjects(workspaceId)

  // ── Project Access draft (§5.1). `baselines` is the server's answer, reported
  // by each project's row/probe; `drafts` holds only what the admin CHANGED;
  // `added` / `removed` are the two row-level edits. Effective value =
  // draft ?? baseline, so a row needs no seeding and cannot be seeded twice.
  const [baselines, setBaselines] = useState<Record<string, ProjectBaseline>>({})
  const [drafts, setDrafts] = useState<Record<string, AccessDraft>>({})
  const [added, setAdded] = useState<string[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)

  const resolveBaseline = useCallback((projectId: string, next: ProjectBaseline) => {
    setBaselines((prev) => ({ ...prev, [projectId]: next }))
  }, [])

  const isVisible = useCallback(
    (projectId: string) =>
      added.includes(projectId) ||
      (baselines[projectId]?.hasAccess === true && !removed.includes(projectId)),
    [added, removed, baselines],
  )

  const effective = useCallback(
    (projectId: string): ResolvedAccess => resolveAccess(drafts[projectId], baselines[projectId]),
    [drafts, baselines],
  )

  const patchDraft = useCallback(
    (projectId: string, patch: Partial<AccessDraft>) => {
      setDrafts((prev) => {
        // Deliberately NOT `...effective(projectId)`: that materialised `teamIds` from whatever the
        // baseline held at this instant, which is `[]` until the memberships query resolves. Carry
        // forward only the keys already in the draft, so an untouched `teamIds` stays absent.
        const current: AccessDraft = prev[projectId] ?? {
          level: baselines[projectId]?.level ?? null,
        }
        return { ...prev, [projectId]: { ...current, ...patch } }
      })
    },
    [baselines],
  )

  function addRow(projectId: string, level: AccessLevel) {
    // Re-adding a project whose access still exists on the server is an UNDO of
    // the Remove, so it restores the baseline instead of becoming a fresh grant.
    setRemoved((prev) => prev.filter((id) => id !== projectId))
    if (!baselines[projectId]?.hasAccess) setAdded((prev) => [...prev, projectId])
    // No `teamIds`: absent resolves to the baseline, which is what makes re-adding a removed project
    // an UNDO rather than a fresh grant that silently drops the teams the user is already in.
    setDrafts((prev) => ({ ...prev, [projectId]: { level } }))
  }

  function removeRow(projectId: string) {
    setAdded((prev) => prev.filter((id) => id !== projectId))
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[projectId]
      return next
    })
    if (baselines[projectId]?.hasAccess) setRemoved((prev) => [...prev, projectId])
  }

  /**
   * Forget the draft entries for the projects whose writes LANDED, and only those.
   *
   * Called on the failure path as well, which is the whole point. `save()` used to
   * clear the draft (and invalidate) only after EVERY change succeeded, so a
   * failure part-way left the ones that had already been written still listed in
   * `changes`: pressing `Confirm & Save` again re-issued a DELETE that had worked,
   * `removeProjectMember` 404'd on it (`findMember` is active-only), and the loop
   * died on that same first change every time — the remaining work could not be
   * applied at all without closing and reopening the modal.
   */
  const forgetApplied = useCallback((projectIds: readonly string[]) => {
    if (projectIds.length === 0) return
    const done = new Set(projectIds)
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !done.has(id))))
    setAdded((prev) => prev.filter((id) => !done.has(id)))
    setRemoved((prev) => prev.filter((id) => !done.has(id)))
  }, [])

  const changes: PendingChange[] = useMemo(() => {
    const out: PendingChange[] = []
    for (const p of projects) {
      const base = baselines[p.id]
      const label = `${p.key} · ${p.name}`
      const visible = added.includes(p.id) || (base?.hasAccess === true && !removed.includes(p.id))
      if (!visible) {
        if (base?.hasAccess) out.push({ kind: 'remove', projectId: p.id, label })
        continue
      }
      const draft = resolveAccess(drafts[p.id], base)
      const levelChanged = draft.level !== (base?.level ?? null)
      // Admin covers every team, so its team rows are not part of the diff.
      const teamsChanged =
        requiresTeamSelection(draft.level) && !sameIds(draft.teamIds, base?.teamIds ?? [])
      if (!base?.hasAccess || levelChanged || teamsChanged) {
        const teams = base?.teams ?? []
        out.push({
          kind: base?.hasAccess ? 'update' : 'grant',
          projectId: p.id,
          label,
          level: draft.level,
          levelChanged,
          teamIds: draft.teamIds,
          teamNames: teams.filter((tm) => draft.teamIds.includes(tm.id)).map((tm) => tm.name),
          projectHasNoTeams: teams.length === 0,
        })
      }
    }
    return out
  }, [projects, baselines, drafts, added, removed])

  const blocked = changes.some(isBlocked)

  // ── General tab: Status (active/suspended) — same hook + confirm-before-
  // suspend behaviour as the Members grid's inline status cell (P4-SET-07).
  const updateMember = useUpdateMember(workspaceId)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const statusLocked = member.userId === user?.id || member.roleSlug === 'workspace_admin'
  const displayLabel = member.displayName ?? member.email ?? member.userId

  function commitStatus(status: MemberStatus) {
    if (status === member.status) return
    // Deactivate and Remove Access are destructive (P4-SET-07): confirm first.
    // Reactivating commits directly — mirrors the Members grid's commitStatus.
    if (status === 'suspended') {
      setConfirmSuspend(true)
      return
    }
    if (status === 'removed') {
      setConfirmRemove(true)
      return
    }
    updateMember.mutate(
      { memberId: member.id, status },
      {
        onSuccess: () => notify.success('Status updated'),
        onError: (e) => notify.fromError(e, 'Failed to update status'),
      },
    )
  }

  /**
   * `Confirm & Save` — the ONE write handler for the whole draft (§5.1).
   *
   * ONE REQUEST PER PROJECT. The level and the Teams used to be separate writes issued in
   * sequence — a POST or PATCH for the level, then one `POST /teams/{id}/members` per team — so a
   * failure between them left an Editor with the level and no Teams, which is precisely the state
   * §2.2 forbids. `POST /v1/projects/{id}/members` now takes `teamIds` alongside `accessLevel` and
   * applies both in ONE transaction, so PRJ-08 is enforceable server-side and a partial write of one
   * project's access is no longer reachable at all.
   *
   * Still sequential ACROSS projects: a failure part-way must not race the rest.
   * Raw `apiClient` rather than the hooks because they bind one projectId at their call site and this
   * loop spans projects — hence the explicit cache invalidation, which `meta.invalidates` would
   * otherwise do.
   *
   * PARTIAL PROGRESS IS KEPT: each project drops out of the draft as its own
   * writes land (`forgetApplied`), and the baselines are re-read in a `finally`.
   * A failure therefore leaves exactly the REMAINING work in `changes`, and
   * `Confirm & Save` retries that and nothing else — see `forgetApplied` for the
   * unrecoverable modal this replaces.
   */
  async function save() {
    setSaving(true)
    // Per project, appended only once that project's writes have all landed.
    const applied: string[] = []
    try {
      for (const change of changes) {
        if (change.kind === 'remove') {
          const { error, response } = await apiClient.DELETE('/v1/projects/{id}/members/{userId}', {
            params: { path: { id: change.projectId, userId: member.userId } },
          })
          if (error) throw new Error(apiErrorMessage(error, response.status))
          applied.push(change.projectId)
          continue
        }
        // `teamIds` only for a level that is team-scoped: absent means "leave the memberships
        // alone", which is what an Admin row must send — its existing rows carry delivery meaning
        // and §5.1 shows no Team control for it, so a promotion must not clear them.
        const { error, response } = await apiClient.POST('/v1/projects/{id}/members', {
          params: { path: { id: change.projectId } },
          body: {
            userId: member.userId,
            ...(change.level ? { accessLevel: change.level } : {}),
            ...(requiresTeamSelection(change.level) ? { teamIds: change.teamIds } : {}),
          } as never,
        })
        if (error) throw new Error(apiErrorMessage(error, response.status))
        applied.push(change.projectId)
      }
      notify.success(t('access.saved'))
      setReviewing(false)
    } catch (e) {
      notify.fromError(e, t('access.saveFailed'))
    } finally {
      // Invalidate FIRST, and on the failure path too. The baselines every change
      // was diffed against are stale either way, and a partial failure needs them
      // re-read most of all: a level write that landed before its team write threw
      // must show up as `levelChanged: false` on the retry, or the retry re-issues
      // it. Awaited so the rows have re-reported before the draft is trimmed.
      await queryClient.invalidateQueries({ queryKey: ['teams'] })
      forgetApplied(applied)
      setSaving(false)
    }
  }

  const rowProjects = projects.filter((p) => isVisible(p.id))
  // A project with access that is merely REMOVED in the draft gets no probe: the
  // probe cannot see team memberships, and overwriting the row's baseline with an
  // empty team list would make the Remove impossible to undo faithfully.
  const probeProjects = projects.filter(
    (p) => baselines[p.id]?.hasAccess !== true && !isVisible(p.id),
  )
  const candidates: SelectOption[] = projects
    .filter((p) => !isVisible(p.id))
    // The key as a CHIP, as every project cell in the app renders it, rather than glued to the name
    // with a separator this screen invented.
    .map((p) => ({
      value: p.id,
      label: p.name,
      searchText: `${p.key} ${p.name}`,
      icon: <KeyChip>{p.key}</KeyChip>,
    }))

  return (
    <AppModal open onClose={onClose} title="Manage Access" width={560}>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as ModalTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-5 pt-3">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="access">Project Access</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="flex min-h-0 flex-1 flex-col">
          <ModalBody className="space-y-5">
            <div className="flex items-center gap-3">
              <OwnerAvatar name={displayLabel} avatarUrl={member.avatarUrl} size={32} />
              <div className="min-w-0">
                <p className="truncate text-ui-sm font-medium text-foreground">{displayLabel}</p>
                {member.email && (
                  <p className="truncate text-ui-xs text-foreground-subtle">{member.email}</p>
                )}
              </div>
            </div>
            <p className="text-ui-xs text-foreground-subtle">
              Name, email and avatar come from your identity provider and cannot be edited here.
            </p>

            <FormField label="Status">
              {isWA && !statusLocked ? (
                <SearchableSelect
                  variant="field"
                  value={member.status}
                  ariaLabel="Status"
                  options={GENERAL_STATUS_OPTIONS}
                  onChange={(v) => commitStatus(v as MemberStatus)}
                />
              ) : (
                <span className="text-ui-sm text-foreground capitalize">
                  {member.status === 'suspended' ? 'Deactive' : member.status}
                </span>
              )}
            </FormField>
          </ModalBody>
        </TabsContent>

        <TabsContent value="access" className="flex min-h-0 flex-1 flex-col">
          <ModalBody className="space-y-4">
            {isLoading ? (
              <div className="flex items-center gap-2 py-6 text-center text-ui-md text-foreground-subtle">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : projects.length === 0 ? (
              <p className="py-6 text-center text-ui-md text-foreground-subtle">
                No Projects available.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {/* §2.1: a Workspace Admin holds every project through the
                    workspace-wide grant, so say so instead of offering a picker. */}
                {targetIsWorkspaceAdmin && (
                  <p className="rounded-lg border border-border-subtle bg-surface-hover px-3 py-2 text-ui-xs text-foreground-subtle">
                    {t('access.workspaceAdminReadOnly')}
                  </p>
                )}
                {rowProjects.map((p) => (
                  <UserProjectAccessRow
                    key={p.id}
                    projectId={p.id}
                    projectKey={p.key}
                    projectName={p.name}
                    userId={member.userId}
                    canEdit={canEditAccess}
                    draft={effective(p.id)}
                    onResolve={resolveBaseline}
                    onChange={patchDraft}
                    onRemove={() => removeRow(p.id)}
                  />
                ))}
                {/* Probes for projects with no row: resolve the baseline (and
                    re-report after a save) without rendering anything. */}
                {probeProjects.map((p) => (
                  <MembershipProbe
                    key={p.id}
                    projectId={p.id}
                    userId={member.userId}
                    onResolve={resolveBaseline}
                  />
                ))}
                {Object.keys(baselines).length > 0 &&
                  rowProjects.length === 0 &&
                  !targetIsWorkspaceAdmin && (
                    <p className="py-2 text-center text-ui-sm text-foreground-subtle">
                      No project access yet.
                    </p>
                  )}
                {canEditAccess && candidates.length > 0 && (
                  <AddProjectAccess candidates={candidates} onAdd={addRow} />
                )}
              </div>
            )}
          </ModalBody>
        </TabsContent>
      </Tabs>

      <ModalFooter className="justify-start">
        {/* AccessService.invalidateUser(s) busts the permission cache on write,
            so this is accurate: a grant/revocation lands on the user's NEXT
            request, not their next sign-in. */}
        <p className="text-ui-xs text-foreground-subtle">
          {targetIsWorkspaceAdmin
            ? t('access.workspaceAdminReadOnlyShort')
            : changes.length > 0
              ? t('access.unsavedHint', { count: changes.length })
              : t('access.effectNextRequest')}
        </p>
        {canEditAccess && (
          <Button
            type="button"
            className="ml-auto"
            disabled={changes.length === 0 || blocked || saving}
            onClick={() => setReviewing(true)}
          >
            {t('access.reviewChanges')}
          </Button>
        )}
      </ModalFooter>

      {/* §5.1's `Review Changes` -> `Confirm & Save`: the summary lists the level
          and the team names the save is about to write, per project. */}
      <ConfirmDialog
        open={reviewing}
        title={t('access.reviewTitle')}
        message={<ReviewList changes={changes} />}
        confirmLabel={t('access.confirmAndSave')}
        cancelLabel={t('access.back')}
        pending={saving}
        onConfirm={save}
        onCancel={() => setReviewing(false)}
      />

      <ConfirmDialog
        open={confirmSuspend}
        title="Deactivate user"
        message={`Deactivate "${displayLabel}"? They lose access until reactivated.`}
        confirmLabel="Deactive"
        destructive
        pending={updateMember.isPending}
        onConfirm={() => {
          setConfirmSuspend(false)
          updateMember.mutate(
            { memberId: member.id, status: 'suspended' },
            {
              onSuccess: () => notify.success('Status updated'),
              onError: (e) => notify.fromError(e, 'Failed to update status'),
            },
          )
        }}
        onCancel={() => setConfirmSuspend(false)}
      />

      {/* Remove Access is high-risk: typed confirmation (type the user's name),
          same rule as the Members grid's per-row Remove Access (P4-SET-07). */}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove user access"
        message={`Permanently remove access for "${displayLabel}". They lose all workspace access.`}
        confirmText={displayLabel}
        confirmLabel="Remove Access"
        destructive
        pending={updateMember.isPending}
        onConfirm={() => {
          setConfirmRemove(false)
          updateMember.mutate(
            { memberId: member.id, status: 'removed' },
            {
              onSuccess: () => {
                notify.success('Status updated')
                onClose()
              },
              onError: (e) => notify.fromError(e, 'Failed to update status'),
            },
          )
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </AppModal>
  )
}

/**
 * The `Review Changes` summary (mockup `SettingsPage.tsx`:438-452): one row per
 * project, its level, and the team names — or the mockup's own
 * "No team membership" when an Editor row has none.
 */
function ReviewList({ changes }: { changes: PendingChange[] }) {
  const { t } = useTranslation('settings')
  if (changes.length === 0) {
    return <span className="text-ui-sm text-foreground-subtle">{t('access.noChanges')}</span>
  }
  return (
    <span className="flex flex-col gap-2">
      {changes.map((change) => (
        <span
          key={change.projectId}
          className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-hover px-3 py-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui-sm font-medium text-foreground">
              {change.label}
            </span>
            <span className="block truncate text-ui-xs text-foreground-subtle">
              {change.kind === 'remove'
                ? t('access.accessRemoved')
                : grantsAllTeams(change.level)
                  ? t('access.allTeams')
                  : change.teamNames.length > 0
                    ? change.teamNames.join(', ')
                    : t('access.noTeamMembership')}
            </span>
          </span>
          <span className="text-ui-xs font-semibold text-foreground capitalize">
            {change.kind === 'remove' ? t('access.noAccess') : change.level}
          </span>
        </span>
      ))}
    </span>
  )
}

/**
 * One project's draft row. Owns that project's QUERIES (so it can report the
 * baseline the save diffs against) and nothing else — the value it renders comes
 * from the parent's draft, and every edit goes back up. It writes nothing.
 */
function UserProjectAccessRow({
  projectId,
  projectKey,
  projectName,
  userId,
  canEdit,
  draft,
  onResolve,
  onChange,
  onRemove,
}: {
  projectId: string
  projectKey: string
  projectName: string
  userId: string
  /**
   * The actor may write this row AND the target may hold a level at all — a
   * Workspace Admin target is `false` here even for a Workspace Admin actor (§2.1).
   */
  canEdit: boolean
  /** The RESOLVED value from `effective()`, never the raw draft — `teamIds` is always concrete here. */
  draft: ResolvedAccess
  onResolve: (projectId: string, baseline: ProjectBaseline) => void
  onChange: (projectId: string, patch: Partial<AccessDraft>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('settings')
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const { data: teams = [] } = useProjectTeams(projectId)
  const teamIds = useMemo(() => teams.map((tm) => tm.id), [teams])
  const { memberTeamIds, isLoading: teamsLoading } = useUserTeamMemberships(teamIds, userId)
  const me = members.find((m) => m.userId === userId)

  // NULL access_level is a real member row (team-derived rows, and rows created
  // before the add-with-level fix) — the user IS in the project, so the row
  // renders and its level select writes through the POST branch on save.
  const baseline: ProjectBaseline = useMemo(
    () => ({
      hasAccess: !!me && me.status === 'active',
      level: me?.accessLevel ?? null,
      teamIds: memberTeamIds,
      teams: teams.map((tm) => ({ id: tm.id, name: tm.name })),
    }),
    [me, memberTeamIds, teams],
  )
  const signature = JSON.stringify(baseline)
  const reported = useRef<string | null>(null)
  useEffect(() => {
    if (isLoading || teamsLoading) return
    if (reported.current === signature) return
    reported.current = signature
    onResolve(projectId, baseline)
  }, [isLoading, teamsLoading, signature, baseline, projectId, onResolve])

  const teamOptions: SelectOption[] = teams.map((tm) => teamSelectOption(tm))

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
      <div className="flex items-end justify-between gap-2">
        <FormField label="Project" className="min-w-0 flex-1">
          {/* Not a picker — this row's project identity is fixed (Rally lists
              every workspace project already, there's nothing to "choose" here).
              Disabled Input keeps the same field-box weight as Access Level/
              Teams below it instead of a bare heading. */}
          <Input
            value={`${projectKey} · ${projectName}`}
            disabled
            aria-label="Project"
            className="disabled:opacity-100"
          />
        </FormField>
        {canEdit && (
          <IconButton
            size="sm"
            aria-label="Remove access"
            title="Remove access (No Access)"
            variant="destructive"
            onClick={onRemove}
            className="mb-0.5"
          >
            <X size={14} />
          </IconButton>
        )}
      </div>

      <FormField label="Access Level">
        {canEdit ? (
          <SearchableSelect
            variant="field"
            value={draft.level ?? ''}
            ariaLabel={`Access level for ${projectName}`}
            placeholder="No Access"
            options={accessSelectOptions}
            onChange={(v) => onChange(projectId, { level: v as AccessLevel })}
          />
        ) : (
          <span className="text-ui-sm text-foreground-subtle capitalize">
            {draft.level ?? 'No Access'}
          </span>
        )}
      </FormField>

      {/* §5.1 :141-143 — Teams for an Editor, `All Teams` for an Admin, nothing
          for a row with no level yet. */}
      {grantsAllTeams(draft.level) && (
        <FormField label={t('access.teams')}>
          <AllTeamsChip />
        </FormField>
      )}
      {requiresTeamSelection(draft.level) && (
        <FormField label={t('access.teams')}>
          {teamOptions.length === 0 ? (
            <p className="text-ui-xs text-foreground-subtle">{t('access.projectHasNoTeams')}</p>
          ) : (
            <>
              <SearchableSelect
                multiple
                variant="field"
                value={draft.teamIds}
                readOnly={!canEdit || teamsLoading}
                options={teamOptions}
                ariaLabel={`Teams for ${projectName}`}
                placeholder={t('access.selectTeams')}
                searchPlaceholder={t('access.searchTeams')}
                onChange={(v) => onChange(projectId, { teamIds: v })}
              />
              {draft.teamIds.length === 0 && (
                <p className="mt-1 text-ui-xs text-warning">{t('access.editorNoTeamWarning')}</p>
              )}
            </>
          )}
        </FormField>
      )}
    </div>
  )
}

/**
 * Invisible baseline probe for a project with no draft row: reports whether the
 * user has access, and the project's teams (so the Add picker and the review
 * step know whether a Team can be picked at all), without rendering anything or
 * paying the per-team membership fan-out.
 */
function MembershipProbe({
  projectId,
  userId,
  onResolve,
}: {
  projectId: string
  userId: string
  onResolve: (projectId: string, baseline: ProjectBaseline) => void
}) {
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const { data: teams = [] } = useProjectTeams(projectId)
  const reported = useRef<string | null>(null)
  useEffect(() => {
    if (isLoading) return
    const me = members.find((m) => m.userId === userId)
    const baseline: ProjectBaseline = {
      hasAccess: !!me && me.status === 'active',
      level: me?.accessLevel ?? null,
      teamIds: [],
      teams: teams.map((tm) => ({ id: tm.id, name: tm.name })),
    }
    const signature = JSON.stringify(baseline)
    if (reported.current === signature) return
    reported.current = signature
    onResolve(projectId, baseline)
  }, [isLoading, members, teams, projectId, userId, onResolve])
  return null
}

/**
 * "+ Add project access" — adds a DRAFT row for an unassigned project (mockup
 * `addProjectAccess`, `SettingsPage.tsx`:305-309). Teams are chosen in the row
 * itself, so this form is just Project + level and writes nothing.
 */
function AddProjectAccess({
  candidates,
  onAdd,
}: {
  candidates: SelectOption[]
  onAdd: (projectId: string, level: AccessLevel) => void
}) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [level, setLevel] = useState<AccessLevel>('editor')

  function handleAdd() {
    if (!projectId) return
    onAdd(projectId, level)
    setProjectId(null)
    setLevel('editor')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add project access
      </Button>
    )
  }
  return (
    <div className="space-y-3 rounded-lg border border-border-subtle p-4">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Project" required>
          <SearchableSelect
            variant="field"
            value={projectId ?? ''}
            ariaLabel="Project to add"
            placeholder="Select project"
            options={candidates}
            onChange={(v) => setProjectId(v as string)}
          />
        </FormField>
        <FormField label="Access Level" required>
          <SearchableSelect
            variant="field"
            value={level}
            ariaLabel="Access level"
            options={accessSelectOptions}
            onChange={(v) => setLevel(v as AccessLevel)}
          />
        </FormField>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" disabled={!projectId} onClick={handleAdd}>
          Add
        </Button>
      </div>
      <p className="text-ui-xs text-foreground-subtle">
        {grantsAllTeams(level) ? t('access.adminCoversAllTeams') : t('access.editorScopedToTeams')}
      </p>
    </div>
  )
}
