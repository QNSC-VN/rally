/**
 * The per-Project access levels, and their labels.
 *
 * Mirrors `PROJECT_ACCESS_LEVEL` in `db/permissions.catalog.ts`, for the same reason
 * `permissions.ts` mirrors the permission codes: the SPA is a separate Vite build with no server
 * path alias, so importing the catalogue would pull server code into the browser bundle. The backend
 * is the source of truth; this is a view of it.
 *
 * One list, because there were two. `projects-access-tab.tsx` and `user-access-modal.tsx` each
 * declared their own `ACCESS_OPTIONS` and each cast to a local `'admin' | 'editor'`, so restoring
 * `viewer` meant finding six casts and two arrays — and the BA's §5 requirement that all three
 * access journeys "update the same Project access and Team membership source" is hard to honour
 * while the vocabulary itself is duplicated.
 */
export const ACCESS_LEVELS = ['admin', 'editor', 'viewer'] as const

export type AccessLevel = (typeof ACCESS_LEVELS)[number]

/**
 * Label and one-line meaning per level, in the order a picker should offer them: most authority
 * first, so the read-only option is not the default a hurried admin lands on.
 *
 * The descriptions are the SRS §2.2 wording, kept here rather than in each picker so the two entry
 * points cannot describe the same level differently.
 */
export const ACCESS_LEVEL_OPTIONS: ReadonlyArray<{
  value: AccessLevel
  label: string
  description: string
}> = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full delivery administration in this project, across all teams.',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Creates and edits delivery work in the teams they are assigned to.',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Read-only. Sees the project and its work items and can change nothing.',
  },
]

/**
 * The same list shaped for `SearchableSelect`.
 *
 * Structurally a `SelectOption[]` without importing that type: this module is the FE mirror of a
 * server catalogue and has no business depending on a UI component, and `{ value, label }` is all
 * the picker requires. Exported ready-made so no caller has to `map` — the two that did each cast
 * through `as unknown as SelectOption[]`, which is the kind of cast that survives a type change.
 */
export const accessSelectOptions: { value: string; label: string }[] = ACCESS_LEVEL_OPTIONS.map(
  ({ value, label }) => ({ value, label }),
)

/** Only an Editor is team-scoped, so only an Editor's form shows Team selection (SRS §5.2). */
export function requiresTeamSelection(level: AccessLevel | null | undefined): boolean {
  return level === 'editor'
}

/**
 * The levels a TEAM member can hold — Admin or Editor, never Viewer.
 *
 * SRS §5.3 on the team-creation journey: "Only Admin and Editor are Team-member choices." Rally
 * agrees from the other direction — "If downgraded to viewer, team member status is automatically
 * removed" — because team membership is what an Editor's write scope is measured against, and a
 * Viewer has no writes to scope.
 *
 * A separate constant rather than a filter at each call site, so the exclusion is a stated rule with
 * a reason attached instead of a narrower union someone widens to match `AccessLevel` for
 * consistency.
 */
export const TEAM_MEMBER_ACCESS_LEVELS = ['admin', 'editor'] as const

export type TeamMemberAccessLevel = (typeof TEAM_MEMBER_ACCESS_LEVELS)[number]

export const teamMemberAccessOptions: { value: string; label: string }[] =
  ACCESS_LEVEL_OPTIONS.filter((o) =>
    (TEAM_MEMBER_ACCESS_LEVELS as readonly string[]).includes(o.value),
  ).map(({ value, label }) => ({ value, label }))
