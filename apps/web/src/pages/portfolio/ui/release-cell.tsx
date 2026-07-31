import { TypeBadge } from '@/entities/work-item/ui/badges'
import { SearchableSelect } from '@/shared/ui/searchable-select'

/**
 * The Release column cell for this grid — release glyph + name, matching the Backlog's
 * Release column (`SearchableSelect` fed the project's releases) and the read-only form
 * Capacity Planning renders. One component so the parent rows and the disclosed child
 * rows cannot drift from each other inside a single column.
 *
 * READ-ONLY on this surface. A Feature's release must belong to the Feature's OWN
 * project and the Portfolio list is cross-project, so the union across every loaded
 * project would offer invalid targets and a per-project fetch would be one request per
 * distinct project on the page. Reassignment lives on the detail page, which knows its
 * single project.
 *
 * Two render paths because the two DTOs differ, not by preference:
 * `PortfolioItemResponseDto` carries `releaseId`, so it gets the real select; the
 * `PortfolioChildResponseDto` used by disclosed Stories/Defects carries only
 * `releaseName`, and a select needs an option VALUE. Inventing one from the name would
 * put a fake id in the DOM, so that path renders the same glyph + truncated name
 * directly. Adding `releaseId` to the child DTO collapses this to one path.
 *
 * Backlog and Capacity Planning still declare this cell inline; promoting one of the
 * three into a shared component is the follow-up (neither can live in `shared/ui` as
 * written — `TypeBadge` is an `entities` module and `shared` cannot import upward).
 */
export function ReleaseCell({
  releaseId,
  releaseName,
  ariaLabel,
}: {
  /** Null for a Story/Defect child, whose DTO does not carry it. */
  releaseId?: string | null
  releaseName?: string | null
  ariaLabel: string
}) {
  if (!releaseName) {
    return <span className="px-2 text-ui-xs text-foreground-disabled">—</span>
  }

  if (!releaseId) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 px-2" title={releaseName}>
        <TypeBadge type="release" size={16} />
        <span className="truncate">{releaseName}</span>
      </span>
    )
  }

  return (
    <SearchableSelect
      variant="cell"
      value={releaseId}
      readOnly
      ariaLabel={ariaLabel}
      placeholder="—"
      options={[
        { value: releaseId, label: releaseName, icon: <TypeBadge type="release" size={16} /> },
      ]}
      onChange={() => undefined}
    />
  )
}
