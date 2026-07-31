import { ChevronDown } from 'lucide-react'

/**
 * The disclosure chevron on a grid row that hides child rows.
 *
 * Extracted from Iteration Status, which had it as a raw `<button>` with six inline styles —
 * both of which the `fe-consistency` ratchet counts, and both of which would have been copied
 * a second time to give Capacity Planning the same affordance.
 *
 * The rotation carries the state visually and `aria-expanded` carries it to a screen reader.
 * The label is a prop rather than derived here, because "Expand tasks" and "Expand the
 * Features allocated to this team" are the caller's vocabulary, not this component's.
 */
export function RowExpandToggle({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean
  onToggle: () => void
  /** Accessible name — describes WHAT expands, e.g. "Expand tasks". */
  label: string
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={label}
      onClick={(e) => {
        // Rows are clickable (they open a detail view); disclosing children is not opening.
        e.stopPropagation()
        onToggle()
      }}
      className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0 text-muted-foreground"
    >
      <ChevronDown
        size={12}
        className="transition-transform duration-150"
        style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
      />
    </button>
  )
}
