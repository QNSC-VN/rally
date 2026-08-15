/**
 * The reader's OWN access level in a project, resolved from a SELF-SCOPED source.
 *
 * WHY THIS EXISTS
 * ---------------
 * `project_members.access_level` is served by exactly one API feed — `GET /projects/:id/members`,
 * the administrative roster — and that feed refuses an Editor: `ProjectsService.listProjectMembers`
 * throws `PROJECT_PERMISSION_DENIED` for any level other than `admin`, because
 * `02_Roles_Permissions/SRS.md:71` marks "View Project `Users & Permissions`" Hidden for an Editor.
 * So a personal surface cannot ask "what is MY level" through it: the answer is a 403, and a caller
 * that defaults the error to `[]` renders it as `No Access` — a false claim about the reader, on the
 * one screen whose entire purpose is telling them the truth about their access.
 *
 * `GET /projects/:projectId/my-permissions` is the self-scoped feed (`@SelfScoped`, no permission
 * decorator, so every authenticated caller may read their own answer) and it is what
 * `useProjectPermissions` already wraps. It returns CODES, not a level, so the level is DERIVED here.
 *
 * THE DERIVATION, AND ITS RESIDUE
 * -------------------------------
 * `workspace:*` first, because it grants every code and would otherwise read as `admin` — a
 * Workspace Admin holds no `project_members` row at all (§2.1: "Workspace Admin is not added as a
 * Project user"), so its authority is workspace-wide and not a level.
 *
 * `project:edit` is then the discriminator between the two per-project levels: `admin` holds it,
 * `editor` does not (`db/permissions.catalog.ts` derives both sets from the tier roles). It is the
 * same code `settings-page.tsx` gates `Permission Model` on, for the same §3.1:65 reason — that row
 * is View for Admin and Hidden for Editor. This is a DERIVATION and not the stored value: if a third
 * level ever returns it will need re-deriving here, and the honest fix is an `accessLevel` field on
 * the self-scoped response (`ProjectPermissionsResponseSchema` carries only `projectId` +
 * `permissions` today), which would let this function be deleted.
 */
import { PERMISSION } from '@/shared/config/permissions'
import { ACCESS_LEVEL_OPTIONS, type AccessLevel } from '@/shared/config/access-levels'

/** `null` = the reader holds no level here: No Access (§2.2, "implicit — no `project_members` row"). */
export type EffectiveProjectLevel = 'workspace_admin' | AccessLevel | null

export function effectiveProjectLevel(can: (code: string) => boolean): EffectiveProjectLevel {
  if (can(PERMISSION.WORKSPACE_ALL)) return 'workspace_admin'
  if (can(PERMISSION.PROJECT_EDIT)) return 'admin'
  if (can(PERMISSION.PROJECT_VIEW)) return 'editor'
  return null
}

/**
 * May this reader open a project's `Users & Permissions` roster?
 *
 * §3.1:71 — Workspace Admin `Edit`, Admin `Read-only`, Editor `Hidden`, No Access `Hidden` — and
 * `P3_RBAC_AND_SYSTEM_STATES.md:56` repeats it ("View Project Users & Permissions | Allowed |
 * Read-only | Hidden"). Deliberately the same rule the SERVER enforces on the feed the tab reads
 * (`listProjectMembers`: `level !== null && level !== 'admin'` refuses), so the tab cannot render for
 * a reader whose first request from it would be a 403.
 *
 * An allow-list, like the server's, so a level added later is Hidden by default rather than admitted.
 */
export function canViewProjectRoster(level: EffectiveProjectLevel): boolean {
  return level === 'workspace_admin' || level === 'admin'
}

/**
 * The level's display label, taken from the shared option list so this page cannot word a level
 * differently from the pickers that write it. `null` has no label here — the caller supplies its own
 * (`access.noAccess`), because "No Access" is the absence of a level and not one of the options.
 */
export function projectLevelLabel(level: AccessLevel): string {
  return ACCESS_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level
}
