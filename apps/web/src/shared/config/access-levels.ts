/**
 * The per-Project access levels, and their labels.
 *
 * Mirrors `PROJECT_ACCESS_LEVEL` in `db/permissions.catalog.ts`, for the same reason
 * `permissions.ts` mirrors the permission codes: the SPA is a separate Vite build with no server
 * path alias, so importing the catalogue would pull server code into the browser bundle. The backend
 * is the source of truth; this is a view of it.
 *
 * One list, because there were three. `projects-access-tab.tsx`, `user-access-modal.tsx` and
 * `project-teams-tab.tsx` each declared their own option array and cast to a local union, so one
 * change to the level set meant hunting nine casts and three arrays. Adding then removing a level in
 * the same week made that concrete.
 *
 * TWO levels, and `No Access` is not one of them: it is the ABSENCE of a `project_members` row (BA
 * §2.2, "implicit — no `project_members` row"), reached through the Remove action and never chosen
 * from a dropdown. Real Rally does have a Viewer level; that divergence is deliberate and explained
 * in `db/permissions.catalog.ts`.
 */
export const ACCESS_LEVELS = ['admin', 'editor'] as const

export type AccessLevel = (typeof ACCESS_LEVELS)[number]

/**
 * Label and one-line meaning per level, most authority first.
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

/**
 * The one level whose authority is measured against TEAMS.
 *
 * The FE mirror of `TEAM_ROSTER_ACCESS_LEVEL` in
 * `libs/modules/access/src/domain/project-access.ts`, and for the same reason it exists there:
 * derived once, so a surface that has to WRITE that level names it instead of spelling `'editor'`.
 * The Editor-Teams dialog is exactly that surface — it exists only to satisfy §2.2's Team
 * requirement, so the level it writes is definitionally this one, not a literal it happens to match.
 */
export const TEAM_SCOPED_LEVEL: AccessLevel = 'editor'

/** Only an Editor is team-scoped, so only an Editor's form shows Team selection (SRS §5.2). */
export function requiresTeamSelection(level: AccessLevel | null | undefined): boolean {
  return level === TEAM_SCOPED_LEVEL
}

/**
 * Whether the level covers every Team in its Project by itself, so the surface renders the
 * words `All Teams` where an Editor gets a picker.
 *
 * SRS §2.2 ("Admin always receives `All Teams`; individual Team selection is not shown"),
 * §5.1 ("Admin displays `All Teams` automatically") and §5.2 ("Selecting Admin
 * automatically grants `All Teams`") all state it, and it is why an Admin needs no
 * `team_members` row at all: an Admin covers every team by definition, so All Teams is the
 * ABSENCE of a scope, never a set of rows some surface has to write. (This used to cite
 * `AccessService.assertTeamScoped`, which was DELETED by ruling on 2026-08-14 — team scope is not
 * an authorization boundary. The display rule the sentence states is unaffected.)
 *
 * The exact inverse of {@link requiresTeamSelection} today, and named separately for the
 * reason §2.2 states the two halves separately: one answers "does this level need a Team
 * picker", the other "what does it display instead". A read-only level — the one that has
 * been added and removed here before — would answer `false` to both, since it has no writes
 * to scope and no authority over every team either.
 */
export function grantsAllTeams(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

/**
 * The levels a TEAM member can hold — SRS §5.3: "Only Admin and Editor are Team-member choices."
 *
 * Identical to {@link ACCESS_LEVELS} today, because those are the only two levels. Kept as its own
 * name rather than collapsed into it, for the same reason §5.3 states the rule separately: the two
 * sets answer different questions, and they HAVE diverged — while a `viewer` level existed this
 * excluded it, since team membership is what an Editor's write scope is measured against and a
 * read-only holder has no writes to scope. Rally agrees from the other direction ("If downgraded to
 * viewer, team member status is automatically removed"). If a third level returns, this is where the
 * exclusion goes.
 */
export const TEAM_MEMBER_ACCESS_LEVELS = ['admin', 'editor'] as const

export type TeamMemberAccessLevel = (typeof TEAM_MEMBER_ACCESS_LEVELS)[number]

export const teamMemberAccessOptions: { value: string; label: string }[] =
  ACCESS_LEVEL_OPTIONS.filter((o) =>
    (TEAM_MEMBER_ACCESS_LEVELS as readonly string[]).includes(o.value),
  ).map(({ value, label }) => ({ value, label }))
