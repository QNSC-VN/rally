import { KeyChip } from '@/shared/ui/key-chip'

/**
 * The project a record belongs to, rendered one way everywhere.
 *
 * Counterpart to {@link TeamCell} and {@link OwnerSelectCell} — a `KeyChip` glyph plus the name —
 * except that unlike a Team or an Owner, a project is **never editable**, so this file offers only
 * the read-only form. A record's Project is chosen once, by the Project context active at creation,
 * and is read-only from then on for every type: Work Items (`WIC-FR-004` AC #11, `WID-FR-017`
 * AC #9), Tasks (Task Management AC #14, where it is derived from the parent) and Portfolio Items
 * (P5 §45 "read-only afterward for both Feature and Epic", §3.1 "Project is read-only for both
 * types", §339 for an Epic).
 *
 * There used to be a `ProjectSelectCell` beside this, a `SearchableSelect` over workspace projects
 * that PATCHed `projectId` — a cross-project MOVE, offered inline on the Portfolio grid's Project
 * column and on its disclosed child Features. It is deleted rather than merely gated off: a
 * `canEdit={false}` prop is one prop away from being passed `true` again, and there is no role or
 * surface for which the move is legal. `moving between Projects unsupported` (`WID-FR-017`) is a
 * property of the field, so it belongs in the component's shape.
 *
 * This lived in `pages/portfolio/ui/attribute-cells.tsx`, so only the Portfolio grid could use it.
 * Seven other surfaces rendered a project as a bare `{projectName ?? '--'}` span — no chip, no key,
 * nothing tying them to the Portfolio column showing the same field. Teams already had exactly this
 * fix (`shared/ui/team-cell.tsx`, used by seven pages); projects did not.
 */

/**
 * Project display — chip + name. The only form there is.
 *
 * Use anywhere a project is shown: detail sidebars, release rows, grid columns, the Tasks tab (a
 * task inherits its parent's project), and the create modals, where it renders the fixed Project
 * context inside a `ReadOnlyFieldValue`. The chip is what makes every one of those recognisably
 * the same field.
 */
export function ProjectCell({
  projectKey,
  projectName,
  className,
}: {
  projectKey?: string | null
  projectName?: string | null
  className?: string
}) {
  if (!projectName && !projectKey) {
    return <span className="text-ui-sm text-muted-foreground">--</span>
  }
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className ?? ''}`}>
      {projectKey && (
        <KeyChip size="sm" tone="project">
          {projectKey}
        </KeyChip>
      )}
      {/* `text-ui-sm`, the size `SearchableSelect variant="cell"` renders at — so a Project sits on
          the same type scale as the Release and Team pickers beside it in a grid row, and as the
          Team/Owner fields beside it in a form. It inherited the row's 12px, which made it a size
          larger than every neighbouring value — the same drift `TeamCell` and `OwnerCell` carried. */}
      <span className="min-w-0 text-ui-sm break-words whitespace-normal text-muted-foreground">
        {projectName ?? projectKey}
      </span>
    </span>
  )
}
