import { TypeBadge } from '@/entities/work-item/ui/badges'
import type { WorkItemType } from '@/entities/work-item/model/types'

interface IdCellProps {
  /** Work-item type — drives the leading {@link TypeBadge} glyph. */
  type: WorkItemType | string
  /** Human item key (US-5 / TA-3 / DE-12 …). */
  itemKey: string
  /** Opens the item detail. Fired from anywhere in the cell (row click intact). */
  onOpen: () => void
}

/**
 * `<IdCell>` — the single, reusable ID column cell shared by every work-item
 * grid (Iteration Status, Defects, Projects, …). Renders the icon-only
 * {@link TypeBadge} plus the monospace item key. The WHOLE cell (icon + key) is
 * one link, so clicking the glyph OR the key opens the item — keeps type glyph
 * + key styling in one place so the ID column can never drift between pages.
 *
 * The wrapping page supplies the column width + horizontal padding via
 * `styleFor('id')`; this component only lays out badge + key.
 */
export function IdCell({ type, itemKey, onOpen }: IdCellProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      title={itemKey}
      className="group flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden border-none bg-transparent p-0 text-left"
    >
      <TypeBadge type={type} />
      <span className="min-w-0 truncate font-mono text-ui-md text-primary-light underline-offset-2 group-hover:underline">
        {itemKey}
      </span>
    </button>
  )
}
