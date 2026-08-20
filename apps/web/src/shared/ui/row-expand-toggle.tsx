import { ChevronDown } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { TARGET_HEIGHT } from '@/shared/ui/target-size'

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
 *
 * A row with NOTHING to disclose passes `disclosable={false}` and gets an inert spacer of the same
 * width instead of a chevron — same pattern, and same reason, as `DragHandle`'s `disabled`: the
 * affordance goes away, the column alignment does not. A chevron that opens onto "No tasks created
 * under this item" promises children the row does not have, and a reader has to click every row to
 * learn which ones actually nest.
 */
export function RowExpandToggle({
  expanded,
  onToggle,
  label,
  disclosable = true,
  reserveSpace = true,
}: {
  expanded: boolean
  onToggle: () => void
  /** Accessible name — describes WHAT expands, e.g. "Expand tasks". */
  label: string
  /**
   * Whether this row has children at all. `false` renders the spacer.
   *
   * The caller must know the count WITHOUT expanding — children are fetched lazily, so a grid that
   * cannot answer "does this row nest?" from its list payload has to keep the chevron.
   */
  disclosable?: boolean
  /**
   * Keep the chevron's width when this row cannot disclose, so the cells beside it stay on one x.
   *
   * `false` where NO row in the grid has children: then the reserved column is 12px of blank space in
   * front of every row, aligned with nothing. A grid that knows it has at least one expandable row
   * reserves; one that knows it has none does not.
   */
  reserveSpace?: boolean
}) {
  // `w-3` is the 12px chevron's box: the ID cell's icon and key stay on the same x on every row.
  if (!disclosable)
    return reserveSpace ? <span aria-hidden="true" className="w-3 shrink-0" /> : null

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
      className={cn(
        TARGET_HEIGHT,
        'flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0 text-muted-foreground',
      )}
    >
      <ChevronDown
        size={12}
        className="transition-transform duration-150"
        style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
      />
    </button>
  )
}
