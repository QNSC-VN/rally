/**
 * Invite a new member — email, the workspace ROLE, the initial per-Project access, and a review
 * step before anything is sent (Settings §6.4 / GAP-P1-USER-006).
 *
 * Split out of `members-tab.tsx`, which held the whole roster grid AND this modal in one 896-line
 * file. The file-length ratchet (`src/test/fe-consistency.ratchet.test.ts`, baseline 943) left 47
 * lines of headroom, which is not enough for a role selector plus a review step plus the comments
 * explaining them — and the spec for this component was already named `invite-user-modal.test.tsx`
 * while importing from `./members-tab`, so this is the shape the repo had already assumed. The
 * PR checklist in `FRONTEND_CONVENTIONS.md` asks for no file over 500 lines.
 *
 * ── The ROLE selector offers exactly TWO choices, and that is the whole model, not a shortcut.
 *
 * `POST /v1/workspaces/{id}/invitations` accepts an optional `roleId`, and it was never sent — so
 * the workspace role was unselectable at invite time (GAP-P1-USER-006a). But the only role an
 * invitation may legitimately carry is `workspace_admin`:
 *
 *   • `workspace_admin` — a workspace-wide grant, which is exactly what an invitation can express.
 *   • `project_admin` / `project_member` — REFUSED at acceptance with
 *     `INVITED_ROLE_IS_PROJECT_TIER` (`WorkspaceService.acceptInvitation`). Under the 3-level model
 *     those tiers are granted per-Project through `project_members.access_level`; a workspace-scoped
 *     grant of one hands the invitee the full delivery set across EVERY project — the legacy
 *     over-grant migration 0111 deleted. Offering them would mint invitations that are permanently
 *     unredeemable, which is worse than not offering them.
 *
 * So "Member" (no `roleId` at all) and "Workspace Admin" are the two states the access model has,
 * and they mirror the only workspace-level distinction the rest of Settings draws — every other
 * surface here branches on `roleSlug === 'workspace_admin'` and nothing else. Custom roles and the
 * editable permission matrix were deleted by the 2026-08-14 ruling, so a general role list would be
 * offering choices the model no longer has. The option is built FROM `GET /v1/roles` rather than
 * from a literal id, because the role row is per-workspace data and its `name` is the admin's.
 *
 * ── The REVIEW step is the §5.1 `Review Changes` -> confirm pattern, reused rather than reinvented.
 *
 * `ConfirmDialog` + a summary node, exactly as `user-access-modal.tsx` does it, down to the
 * `access.reviewChanges` / `access.back` copy. An invitation writes a workspace membership, a
 * workspace role grant and a set of project grants in one irreversible action (the mail goes out
 * with it), so the last thing the inviter sees should be what is about to be sent.
 */
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { Loader2, Mail, Plus, X } from 'lucide-react'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useProjects } from '@/features/projects/api'
import {
  ACCESS_LEVEL_OPTIONS,
  accessSelectOptions,
  type AccessLevel,
} from '@/shared/config/access-levels'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { FormField } from '@/shared/ui/form-field'
import { IconButton } from '@/shared/ui/icon-button'
import { Input } from '@/shared/ui/input'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { useSystemRoles } from '../model/use-system-roles'

type InviteForm = { email: string }

/** One project + the level the invitee lands with. */
interface AccessRow {
  projectId: string
  accessLevel: AccessLevel
}

/**
 * The sentinel for "no workspace role" — an invitation that sends no `roleId`, so the invitee joins
 * as an ordinary member whose authority is entirely per-Project. A named constant rather than `''`
 * because `SearchableSelect` reads the empty string as "nothing selected" and would show its
 * placeholder for what is a deliberate, and the DEFAULT, choice.
 */
const NO_WORKSPACE_ROLE = 'member'

/** The only workspace-wide role an invitation may grant — see the docblock. */
const INVITABLE_ROLE_SLUG = 'workspace_admin'

const LEVEL_LABEL = new Map(ACCESS_LEVEL_OPTIONS.map((o) => [o.value as string, o.label]))

/**
 * One row of the initial-access repeater: a project and the level the invitee lands with.
 *
 * `accessSelectOptions` is the ONE option list (`shared/config/access-levels.ts`) — never a local
 * array. That file exists because three surfaces each declared their own and drifted, and adding
 * then removing a level in one week (migrations 0113, 0115) is what made the cost concrete.
 */
function InviteAccessRow({
  row,
  projectOptions,
  onChangeProject,
  onChangeLevel,
  onRemove,
}: {
  row: AccessRow
  projectOptions: SelectOption[]
  onChangeProject: (projectId: string) => void
  onChangeLevel: (level: AccessLevel) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <SearchableSelect
          variant="field"
          value={row.projectId}
          ariaLabel={t('members.projectFieldLabel')}
          placeholder={t('members.selectProject')}
          options={projectOptions}
          onChange={onChangeProject}
        />
      </div>
      <div className="w-32 shrink-0">
        <SearchableSelect
          variant="field"
          value={row.accessLevel}
          ariaLabel={t('members.accessFieldLabel')}
          options={accessSelectOptions}
          onChange={(v) => onChangeLevel(v as AccessLevel)}
        />
      </div>
      <IconButton
        aria-label={t('members.removeProjectAccess')}
        onClick={onRemove}
        title={t('members.removeProjectAccess')}
      >
        <X size={13} />
      </IconButton>
    </div>
  )
}

/**
 * The review summary — what `Send invitation` is about to send, and nothing else.
 *
 * Rendered as `<span>`s, not `<div>`s, on purpose: `ConfirmDialog` puts `message` inside a `<p>`,
 * so a block element here is invalid HTML that React will hoist out of the paragraph. Same reason
 * `user-access-modal.tsx`'s `ReviewList` is built the same way.
 */
function InviteReviewSummary({
  email,
  roleLabel,
  rows,
  projectLabels,
}: {
  email: string
  roleLabel: string
  rows: AccessRow[]
  projectLabels: Map<string, string>
}) {
  const { t } = useTranslation('settings')
  return (
    <span className="flex flex-col gap-3">
      <span className="flex flex-col gap-1">
        <span className="text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
          {t('members.reviewEmail')}
        </span>
        <span className="text-ui-sm text-foreground">{email}</span>
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
          {t('members.reviewRole')}
        </span>
        <span className="text-ui-sm text-foreground">{roleLabel}</span>
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
          {t('members.reviewProjectAccess')}
        </span>
        {rows.length === 0 ? (
          <span className="text-ui-sm text-foreground-subtle">
            {t('members.reviewNoProjectAccess')}
          </span>
        ) : (
          rows.map((row) => (
            <span
              key={row.projectId}
              className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-hover px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
                {projectLabels.get(row.projectId) ?? row.projectId}
              </span>
              <span className="text-ui-xs font-semibold text-foreground">
                {LEVEL_LABEL.get(row.accessLevel) ?? row.accessLevel}
              </span>
            </span>
          ))
        )}
      </span>
    </span>
  )
}

/**
 * Exported for its own spec. The initial-access repeater is a §6.4 CONTRACT — what the modal sends
 * decides whether a new joiner can see anything — and mounting the whole members table to reach it
 * would test the table instead.
 */
export function InviteUserModal({
  workspaceId,
  onClose,
  onSuccess,
}: {
  workspaceId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation('settings')
  const inviteSchema = z.object({
    email: z.string().email(t('members.invalidEmail')),
  })
  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '' },
  })

  /**
   * §6.4 — the projects and levels the invitee lands with. Kept out of react-hook-form because it
   * is a repeater whose rows are added and removed, not a fixed field set; the same shape
   * `project-teams-tab.tsx` uses for its per-member access map.
   *
   * EMPTY IS THE DEFAULT AND IT IS LEGAL: no rows means no initial project access, which is what an
   * invitation did before §6.4. The point of the section is that the inviter can see the choice
   * exists — before this, inviting and granting were separate actions and only the first was on
   * this screen, so the common path produced a member who signs in and can see nothing.
   */
  const [projectAccess, setProjectAccess] = useState<AccessRow[]>([])
  const [roleChoice, setRoleChoice] = useState<string>(NO_WORKSPACE_ROLE)
  const [reviewing, setReviewing] = useState(false)
  const { data: projects = [] } = useProjects(workspaceId)
  const { data: roles = [] } = useSystemRoles()

  const invitableRole = roles.find((r) => r.slug === INVITABLE_ROLE_SLUG)
  const roleOptions = useMemo<SelectOption[]>(
    () => [
      { value: NO_WORKSPACE_ROLE, label: t('members.roleMemberOption') },
      ...(invitableRole ? [{ value: invitableRole.id, label: invitableRole.name }] : []),
    ],
    [t, invitableRole],
  )
  const roleLabel =
    roleOptions.find((o) => o.value === roleChoice)?.label ?? t('members.roleMemberOption')

  /** A project already on another row is not offerable again — the API refuses duplicates. */
  const projectOptionsFor = (rowIndex: number): SelectOption[] => {
    const taken = new Set(projectAccess.filter((_, i) => i !== rowIndex).map((r) => r.projectId))
    return projects
      .filter((p) => !taken.has(p.id))
      .map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))
  }

  const projectLabels = useMemo(
    () => new Map(projects.map((p) => [p.id, `${p.key} · ${p.name}`])),
    [projects],
  )

  const unusedProjects = projects.filter((p) => !projectAccess.some((r) => r.projectId === p.id))
  /** Rows the request will actually carry — a row whose project was cleared sends nothing. */
  const rows = projectAccess.filter((r) => r.projectId !== '')

  function addAccessRow() {
    const next = unusedProjects[0]
    if (!next) return
    // Defaults to the team-scoped level, never Admin: Admin is All Teams by definition, so an
    // invitation should not hand it out by default. The inviter picks it deliberately.
    setProjectAccess((prev) => [...prev, { projectId: next.id, accessLevel: 'editor' }])
  }

  const invite = useMutation({
    mutationFn: async (data: InviteForm) => {
      const { error, response } = await apiClient.POST('/v1/workspaces/{id}/invitations', {
        params: { path: { id: workspaceId } },
        // Each half OMITTED rather than sent empty when nothing was chosen. Absent `projectAccess`
        // means "no initial access", which is what every invitation created before §6.4 carries;
        // absent `roleId` means "no workspace-wide role", which is the ordinary member.
        body: {
          email: data.email,
          ...(roleChoice !== NO_WORKSPACE_ROLE && { roleId: roleChoice }),
          ...(rows.length > 0 && { projectAccess: rows }),
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      notify.success(t('members.inviteSent'))
      onSuccess()
    },
    onError: (err: Error) => {
      // Back to the form, not stranded behind the review dialog: the message belongs beside the
      // field that has to change (a duplicate address, a project that vanished).
      setReviewing(false)
      form.setError('root', { message: err.message })
    },
    meta: { invalidates: ['workspace'] },
  })

  return (
    <AppModal open onClose={onClose} title={t('members.invitePanelTitle')} width={460}>
      {/* Submit opens the REVIEW step; it does not send. `handleSubmit` still runs the zod
          resolver first, so an invalid address never reaches a summary claiming it is about to
          be invited. */}
      <form onSubmit={form.handleSubmit(() => setReviewing(true))}>
        <ModalBody className="space-y-4">
          <FormField
            label={t('members.emailFieldLabel')}
            required
            error={form.formState.errors.email?.message}
          >
            <Input
              {...form.register('email')}
              type="email"
              autoFocus
              placeholder="colleague@company.com"
            />
          </FormField>
          <FormField label={t('members.roleFieldLabel')} hint={t('members.roleFieldHint')}>
            <SearchableSelect
              variant="field"
              value={roleChoice}
              ariaLabel={t('members.roleFieldLabel')}
              options={roleOptions}
              onChange={setRoleChoice}
            />
          </FormField>
          <FormField label={t('members.initialAccessLabel')} hint={t('members.initialAccessHint')}>
            <div className="space-y-2">
              {projectAccess.map((row, i) => (
                <InviteAccessRow
                  key={`${row.projectId}-${i}`}
                  row={row}
                  projectOptions={projectOptionsFor(i)}
                  onChangeProject={(projectId) =>
                    setProjectAccess((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, projectId } : r)),
                    )
                  }
                  onChangeLevel={(accessLevel) =>
                    setProjectAccess((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, accessLevel } : r)),
                    )
                  }
                  onRemove={() => setProjectAccess((prev) => prev.filter((_, j) => j !== i))}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAccessRow}
                disabled={unusedProjects.length === 0}
              >
                <Plus size={13} /> {t('members.addProjectAccess')}
              </Button>
            </div>
          </FormField>
          {form.formState.errors.root && (
            <p role="alert" className="text-ui-md text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {t('access.reviewChanges')}
          </Button>
        </ModalFooter>
      </form>

      {/* Outside the `<form>`: `ConfirmDialog`'s buttons are `type="button"`, but nesting a second
          form's worth of controls inside this one has no reason to exist. */}
      <ConfirmDialog
        open={reviewing}
        title={t('members.reviewInviteTitle')}
        message={
          <InviteReviewSummary
            email={form.getValues('email')}
            roleLabel={roleLabel}
            rows={rows}
            projectLabels={projectLabels}
          />
        }
        confirmLabel={t('members.sendInvite')}
        cancelLabel={t('access.back')}
        pending={invite.isPending}
        onConfirm={() => invite.mutate(form.getValues())}
        onCancel={() => setReviewing(false)}
      />
    </AppModal>
  )
}
