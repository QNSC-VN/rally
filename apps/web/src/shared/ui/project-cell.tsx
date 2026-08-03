import { KeyChip } from '@/shared/ui/key-chip'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'

/**
 * The project a record belongs to, rendered one way everywhere.
 *
 * Counterpart to {@link TeamCell} and {@link OwnerSelectCell}: the same shape the app settled on
 * for an assignable reference — a `KeyChip` glyph plus the name, through the shared
 * `SearchableSelect` in its `cell` variant when editable, and the same glyph as flat text when not.
 *
 * This lived in `pages/portfolio/ui/attribute-cells.tsx`, so only the Portfolio grid could use it.
 * Seven other surfaces rendered a project as a bare `{projectName ?? '--'}` span — no chip, no key,
 * nothing tying them to the Portfolio column showing the same field. Teams already had exactly this
 * fix (`shared/ui/team-cell.tsx`, used by seven pages); projects did not.
 */

/** The minimum a project must expose to be offered as an option. */
export interface ProjectOption {
  id: string
  key: string
  name: string
}

/**
 * Read-only project display — chip + name.
 *
 * Use where a project is shown but cannot be changed here: detail sidebars, release rows, the
 * Tasks tab (a task inherits its parent's project). The chip is what makes it recognisably the
 * same field as the Portfolio grid's Project column.
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
    return <span className="text-muted-foreground">--</span>
  }
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className ?? ''}`}>
      {projectKey && (
        <KeyChip size="sm" tone="project">
          {projectKey}
        </KeyChip>
      )}
      <span className="min-w-0 break-words whitespace-normal text-muted-foreground">
        {projectName ?? projectKey}
      </span>
    </span>
  )
}

/**
 * Editable project cell — a MOVE, not a plain field write.
 *
 * The server resets the Team to one linked to the destination and drops a Release or parent Epic
 * belonging to the old project (`applyProjectMove`), so a caller's toast should say "moved" rather
 * than "updated" and expect the row's other cells to change with it.
 *
 * No clear option: a record ALWAYS belongs to a project, unlike every other reference.
 */
export function ProjectSelectCell({
  projectId,
  projectName,
  projects,
  canEdit,
  ariaLabel,
  onChange,
}: {
  projectId: string
  projectName?: string | null
  projects: ProjectOption[]
  canEdit: boolean
  ariaLabel: string
  onChange: (projectId: string) => void
}) {
  if (!canEdit) {
    return (
      <span className="px-2 break-words whitespace-normal text-muted-foreground">
        {projectName ?? '--'}
      </span>
    )
  }

  const options: SelectOption[] = projects.map((p) => ({
    value: p.id,
    label: p.name,
    searchText: `${p.key} ${p.name}`,
    icon: (
      <KeyChip size="sm" tone="project">
        {p.key}
      </KeyChip>
    ),
  }))

  // The current project may sit outside the offered list (archived, or not visible to this
  // caller). Prepend it so the cell shows what the record actually holds instead of blank.
  if (!projects.some((p) => p.id === projectId)) {
    options.unshift({ value: projectId, label: projectName ?? projectId })
  }

  return (
    <SearchableSelect
      variant="cell"
      value={projectId}
      // A project name is long enough to matter, and Rally wraps this column.
      wrapLabel
      ariaLabel={ariaLabel}
      searchPlaceholder="Search"
      options={options}
      onChange={onChange}
    />
  )
}
