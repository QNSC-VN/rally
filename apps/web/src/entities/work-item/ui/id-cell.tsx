import { TypeBadge } from '@/entities/work-item/ui/badges'
import type { WorkItemType } from '@/entities/work-item/model/types'

interface IdCellProps {
  /** Work-item type — drives the leading {@link TypeBadge} glyph. */
  type: WorkItemType | string
  /** Human item key (US-5 / TA-3 / DE-12 …). */
  itemKey: string
  /** Opens the item detail. Fired from the key link (row click is left intact). */
  onOpen: () => void
}

/**
 * `<IdCell>` — the single, reusable ID column cell shared by every work-item
 * grid (Iteration Status, Defects, …). Renders the icon-only {@link TypeBadge}
 * plus the monospace item key as a link. Keeps type glyph + key styling in one
 * place so the ID column can never drift between pages.
 *
 * The wrapping page supplies the column width + horizontal padding via
 * `styleFor('id')`; this component only lays out badge + key.
 */
export function IdCell({ type, itemKey, onOpen }: IdCellProps) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      <TypeBadge type={type} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        title={itemKey}
        className="min-w-0 cursor-pointer truncate border-none bg-transparent p-0 text-left font-mono text-ui-md text-primary-light underline-offset-2 hover:underline"
      >
        {itemKey}
      </button>
    </div>
  )
}
