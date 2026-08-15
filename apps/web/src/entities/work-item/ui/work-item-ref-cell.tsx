import { TypeBadge } from '@/entities/work-item/ui/badges'
import type { PortfolioItemType, WorkItemType } from '@/entities/work-item/model/types'

interface WorkItemRefCellProps {
  /**
   * Referenced artifact type — drives the leading glyph + colour. Accepts a
   * portfolio type too: the Feature column on Backlog/Iteration Status points at
   * a `portfolio_items` row, and it renders through this same cell so a reference
   * looks identical wherever it appears.
   */
  type: WorkItemType | PortfolioItemType
  /** Referenced item key, e.g. `FE-1` / `US-6`. */
  itemKey: string
  /** Optional title; when present it is appended as `KEY: Title` (Rally parity). */
  title?: string | null
  /** Open the referenced item (navigation is owned by the caller). */
  /**
   * Absent means NOT A LINK: the label renders as plain text with the same glyph and no button
   * semantics. A grid may hold a reference to a record the reader cannot open — §3.2:85 hides
   * Portfolio Items from an Editor while their Story still names its Feature — and a link that lands
   * on Access Denied is worse than a label, because it is offered as the way forward.
   */
  onOpen?: () => void
  /**
   * Visual treatment:
   * - `inline` (default) — bare glyph + text for use inside grid cells.
   * - `pill` — bordered, padded link for use in sidebars / detail panels.
   */
  variant?: 'inline' | 'pill'
}

/**
 * `<WorkItemRefCell>` — the single source of truth for rendering a work-item
 * reference: the type glyph followed by `KEY: Title`. Shared by every grid (inline
 * variant) and every detail sidebar (pill variant) so a work-item reference renders
 * identically everywhere. Stops click propagation so it opens the referenced item, not
 * the surrounding row.
 *
 * The two variants differ on long text, deliberately: `inline` WRAPS, because a grid row
 * uses `min-h-*` and can grow, and the title is free text; `pill` still truncates,
 * because it sits in a fixed-width detail sidebar where growth would push the rest of
 * the panel around.
 */
export function WorkItemRefCell({
  type,
  itemKey,
  title,
  onOpen,
  variant = 'inline',
}: WorkItemRefCellProps) {
  const label = title ? `${itemKey}: ${title}` : itemKey
  const open = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    onOpen?.()
  }

  if (!onOpen) {
    return (
      <span
        title={label}
        className={
          variant === 'pill'
            ? 'flex w-full items-center gap-1.5 truncate rounded border border-input px-2.5 py-1.5 text-ui-sm text-foreground'
            : 'inline-flex max-w-full items-start gap-1.5 text-foreground'
        }
      >
        <TypeBadge type={type} size={16} />
        <span className="truncate">{label}</span>
      </span>
    )
  }

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={open}
        title={label}
        // `text-ui-sm`, matching the read-only rendering above and every other editable cell: this
        // trigger was 12px, so opening the same value for edit made it grow.
        className="flex w-full cursor-pointer items-center gap-1.5 truncate rounded border border-input px-2.5 py-1.5 text-ui-sm text-primary-light hover:bg-slate-50"
      >
        <TypeBadge type={type} size={16} />
        <span className="truncate">{label}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      title={label}
      // `items-start` + wrapping label: the reference carries a work-item TITLE, which is
      // free text of unbounded length, and every grid that shows it uses `min-h-*` rows
      // that can grow. `items-start` keeps the type glyph on the first line instead of
      // floating to the vertical middle of a two-line title.
      className="inline-flex max-w-full cursor-pointer items-start gap-1.5 border-none bg-transparent p-0"
      onMouseOver={(e) => {
        e.currentTarget.style.textDecoration = 'underline'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.textDecoration = 'none'
      }}
    >
      <TypeBadge type={type} size={16} />
      {/* `min-h-5` so a one-line reference centres against its type glyph instead of riding its top
          edge — the same rule the team, owner and ID cells follow. */}
      <span className="flex min-h-5 min-w-0 items-center text-ui-sm break-words whitespace-normal text-primary-light">
        {label}
      </span>
    </button>
  )
}
