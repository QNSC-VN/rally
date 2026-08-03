import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

/**
 * A pair of one-position reorder controls — up, down — for a rank cell.
 *
 * Portfolio Items ranks exactly this way and no other: SRS §37 makes Rank "up/down reorder buttons
 * only, **no drag-and-drop**", and §14 lists drag under Not included. That grid dragged instead, which
 * also left keyboard users with no way to rank until the shared grip gained a keyboard sensor.
 *
 * They sit INSIDE the rank cell, beside the number they change — which is also why §59 carves them out
 * of the row's click-to-open, along with the inline editors and the disclosure chevron.
 *
 * Labels arrive already TRANSLATED, like `WarningIndicator`'s: `shared/ui` must not reach into a
 * feature's copy, and "Move up" alone says nothing in a screen-reader list — the caller names the row.
 *
 * A missing handler renders a DISABLED button rather than a gap: the first row cannot move up and the
 * last cannot move down, and a cell whose buttons come and go shifts the number beside them. A MENU
 * omits such items instead (capacity's does), which is right for a menu and wrong for a fixed cell.
 */
export function ReorderButtons({
  upLabel,
  downLabel,
  onMoveUp,
  onMoveDown,
  size = 12,
}: {
  upLabel: string
  downLabel: string
  onMoveUp?: () => void
  onMoveDown?: () => void
  size?: number
}) {
  return (
    // `onClick` stops here: a row that opens on click must not open when its order is changed.
    <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <IconButton label={upLabel} onClick={onMoveUp} icon={<ChevronUp size={size} />} />
      <IconButton label={downLabel} onClick={onMoveDown} icon={<ChevronDown size={size} />} />
    </span>
  )
}

function IconButton({
  label,
  onClick,
  icon,
}: {
  label: string
  onClick?: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={onClick === undefined}
      onClick={onClick}
      className={cn(
        'rounded p-0.5 text-muted-foreground transition-colors',
        'hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        'disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent',
      )}
    >
      {icon}
    </button>
  )
}
