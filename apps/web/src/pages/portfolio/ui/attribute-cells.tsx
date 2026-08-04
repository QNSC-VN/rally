/**
 * The related-entity cells for the Portfolio grid: Release, Team, Project.
 *
 * All three follow the shape the rest of the app settled on for an assignable
 * reference — the shared `SearchableSelect` in its `cell` variant, each option carrying
 * the entity's own glyph (release badge, epic badge, square team chip) — so the Backlog,
 * Capacity Planning and this grid render the same reference the same way. When the
 * caller cannot edit the row they fall back to the read-only display component for that
 * attribute type, which is what keeps a viewer's grid looking like an editor's.
 *
 * One module rather than three because the parent rows and the disclosed child Feature
 * rows both need all three, and a column that renders differently at two nesting levels
 * of the SAME grid is the exact drift this page was cleaned up to remove.
 *
 * ── Why Release and Team options are per-project ─────────────────────────────
 * A Feature's Release and Team must belong to the Feature's OWN project, and this list can
 * be opened up to every project. So the row is handed the option lists for ITS project
 * (see `usePortfolioCellOptions`) rather than a workspace-wide union, which would offer
 * targets the API rejects. Project is the exception: a MOVE targets a different project by
 * definition, so its options are workspace-wide.
 */
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { TeamAvatar, TeamCell } from '@/shared/ui/team-cell'
import { type PortfolioCellOptions } from '../model/cell-options'

/** The em-dash every one of these cells shows when the value is unset. */
function EmptyCell() {
  return <span className="px-2 text-ui-xs text-foreground-disabled">--</span>
}

/** `— No Entry —` first, matching the owner picker's Quick Picks vocabulary. */
const clearOption: SelectOption = { value: '', label: '— No Entry —' }

/**
 * Release column — the Backlog's release cell (glyph + `RE-1: name`).
 *
 * `releaseKey` comes from the RELEASES list, not from the portfolio DTO, which carries
 * only `releaseName`. So the editable path can render Rally's full `RE-1: v2.0 — …`
 * label while the read-only path falls back to the bare name it was given.
 */
export function ReleaseSelectCell({
  releaseId,
  releaseName,
  releases,
  canEdit,
  ariaLabel,
  onChange,
}: {
  /** Absent for a Story/Defect child, whose DTO carries no release id. */
  releaseId?: string | null
  releaseName?: string | null
  releases: PortfolioCellOptions['releases']
  canEdit: boolean
  ariaLabel: string
  onChange: (releaseId: string | null) => void
}) {
  // Unset AND not assignable: nothing to show and nothing to pick. Note the order —
  // an unset release must still offer the picker when the caller may edit and the
  // project HAS releases, or a row could never be given its first release. That was
  // the bug: the empty case returned before the editable case was considered.
  if (!releaseId && !releaseName && (!canEdit || releases.length === 0)) {
    return <EmptyCell />
  }

  // A name but no id — a child whose payload carries only the display name. Render the
  // same glyph + name rather than inventing an id for the select to bind to.
  if (!releaseId && releaseName) {
    return (
      <span className="flex min-w-0 items-start gap-1.5 px-2" title={releaseName}>
        <TypeBadge type="release" size={16} />
        {/* WRAPS, at the same size the editable cell renders: `RE-1: v2.0 — NX Platform Upgrade` is a
            name, and truncating it here while the picker one row up wrapped it made the child row look
            like a different column. `min-h-5` centres a one-liner against the glyph. */}
        <span className="flex min-h-5 min-w-0 items-center text-ui-sm break-words whitespace-normal">
          {releaseName}
        </span>
      </span>
    )
  }

  const options: SelectOption[] = [
    clearOption,
    ...releases.map((r) => ({
      value: r.id,
      label: r.releaseKey ? `${r.releaseKey}: ${r.name}` : r.name,
      searchText: `${r.releaseKey ?? ''} ${r.name}`,
      icon: <TypeBadge type="release" size={16} />,
    })),
  ]

  // The current release may be missing from the options (archived, or a project whose
  // releases were never loaded). Splice it in so the cell shows its own value rather
  // than falling back to the placeholder.
  if (releaseId && !releases.some((r) => r.id === releaseId)) {
    options.splice(1, 0, {
      value: releaseId,
      label: releaseName ?? releaseId,
      icon: <TypeBadge type="release" size={16} />,
    })
  }

  return (
    <SearchableSelect
      variant="cell"
      value={releaseId ?? ''}
      // `RE-1: v2.0 — NX Platform Upgrade` is a name, not a code — same case as Project.
      wrapLabel
      readOnly={!canEdit}
      ariaLabel={ariaLabel}
      placeholder="--"
      searchPlaceholder="Search"
      options={options}
      onChange={(v) => onChange(v || null)}
    />
  )
}

// `ProjectSelectCell` now lives in `shared/ui/project-cell.tsx` — it is re-exported below so
// this module stays the single import site for the grid's related-entity cells.
export { ProjectSelectCell, type ProjectOption } from '@/shared/ui/project-cell'

/**
 * Team column — square key-chip + name (circle = person, square = team).
 *
 * Editable: a picker over the teams LINKED TO the row's project, because an unlinked
 * team is not a legal assignment. Read-only: the shared `TeamCell`.
 */
export function TeamSelectCell({
  teamId,
  teamName,
  teams,
  canEdit,
  ariaLabel,
  onChange,
}: {
  /** Absent for a Story/Defect child, whose DTO carries no team id. */
  teamId?: string | null
  teamName?: string | null
  teams: PortfolioCellOptions['teams']
  canEdit: boolean
  ariaLabel: string
  onChange: (teamId: string | null) => void
}) {
  // The team's KEY, so the chip reads the same two letters here as in the picker's own options below.
  // Without it `TeamAvatar` falls back to the name's initials, and one team then draws two glyphs
  // depending on which branch of this cell rendered it.
  const teamKey = teams.find((tm) => tm.id === teamId)?.key ?? null

  // No id to bind a select's value to — a Story/Defect child. The read-only chip, which
  // already renders its own em-dash when there is nothing to show.
  if (!teamId) {
    if (!canEdit || teams.length === 0)
      return <TeamCell teamKey={teamKey} name={teamName} className="px-2" />
  }

  const options: SelectOption[] = [
    clearOption,
    ...teams.map((tm) => ({
      value: tm.id,
      label: tm.name,
      searchText: `${tm.key} ${tm.name}`,
      icon: <TeamAvatar teamKey={tm.key} name={tm.name} size={16} />,
    })),
  ]

  if (teamId && !teams.some((tm) => tm.id === teamId)) {
    options.splice(1, 0, {
      value: teamId,
      label: teamName ?? teamId,
      icon: <TeamAvatar name={teamName} size={16} />,
    })
  }

  return (
    <SearchableSelect
      variant="cell"
      value={teamId ?? ''}
      readOnly={!canEdit}
      ariaLabel={ariaLabel}
      placeholder="--"
      searchPlaceholder="Search"
      options={options}
      onChange={(v) => onChange(v || null)}
    />
  )
}
