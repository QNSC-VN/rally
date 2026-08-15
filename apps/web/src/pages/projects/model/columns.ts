import type { UpdateProjectInput } from '@/features/projects/api'
import type { OwnerSelectMember } from '@/shared/ui/owner-cell'

export type ProjectColKey =
  'key' | 'name' | 'status' | 'owner' | 'teams' | 'members' | 'startDate' | 'endDate' | 'updated'

/**
 * Per-render context for the Projects grid cells. Only the Key column links to
 * the detail page; every other editable column edits inline (like Iteration
 * Status) via `onPatch`, so the row carries the mutation wiring + lookups.
 */
export interface ProjectCtx {
  currentUserId?: string
  currentUserName?: string
  /** Owner (Project lead) options for the inline owner dropdown. */
  members: OwnerSelectMember[]
  /**
   * Does the caller hold `workspace:edit`? — the ONE fact every mutating cell on this grid turns
   * on, because every write behind them requires exactly that code: `PATCH /projects/:id`
   * (Name / Status / Owner / Start / End) and `POST|DELETE /projects/:id/teams` (Teams) all carry
   * `@RequirePermission('workspace:edit')` (`projects.controller.ts:276,505,520`).
   *
   * Structural authority is Workspace Admin's alone, and a per-project Admin explicitly does NOT
   * have it: "Create, edit, archive, restore or delete Project | Edit | Hidden | Hidden | Hidden"
   * and "Assign Project access and Team membership | Edit | Read-only view only | Hidden | Hidden"
   * (`Phase 4/02_Roles_Permissions/SRS.md:68,64`), while the same table gives Admin and Editor
   * "View Project Details and Teams | Edit | Read-only | Read-only, scoped | Hidden" (`SRS.md:70`).
   * `P3_RBAC_AND_SYSTEM_STATES.md:57` restates it: "Create/Edit/Archive/Delete Project | Allowed |
   * Hidden | Hidden".
   *
   * So the grid itself stays visible (SRS.md:67 shows it to both levels) and the cells become the
   * BA's Read-only state: "Data is visible; mutation control is absent | Plain value/detail field,
   * not a disabled input" (`P3_RBAC_AND_SYSTEM_STATES.md:34`). Each shared cell editor already has
   * that mode — `InlineEditableCell canEdit={false}`, `SearchableSelect readOnly`, `DateField
   * readOnly`, `OwnerSelectCell canEdit={false}` all render a plain value, never a disabled input.
   *
   * It is `false` for a per-project Admin and for an Editor, which is what it must be: the two
   * defects this replaced were an UNGATED Teams picker (an Editor could tick a team and the server
   * refused) and five editors that opened, accepted a keystroke and reverted because `onPatch` was
   * `undefined` — silently inert, and now that a 403 no longer redirects, silent for the Teams
   * picker too.
   */
  canEdit: boolean
  /**
   * Inline commit — one shared project mutation for the whole list. Set by the page IF AND ONLY IF
   * `canEdit`, so a cell that renders an editable control always has a write behind it.
   */
  onPatch?: (id: string, input: UpdateProjectInput) => void
  /** Open the detail page (Key link). */
  onOpen: (projectKey: string) => void
}
