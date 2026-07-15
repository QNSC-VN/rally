import { BRAND } from '@/shared/config/brand'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import type { WorkItemType } from '@/entities/work-item/model/types'

interface WorkItemRefCellProps {
  /** Referenced work-item type — drives the leading glyph + colour. */
  type: WorkItemType
  /** Referenced item key, e.g. `FE000001` / `US000006`. */
  itemKey: string
  /** Optional title; when present it is appended as `KEY: Title` (Rally parity). */
  title?: string | null
  /** Open the referenced item (navigation is owned by the caller). */
  onOpen: () => void
  /**
   * Visual treatment:
   * - `inline` (default) — bare glyph + text for use inside grid cells.
   * - `pill` — bordered, padded link for use in sidebars / detail panels.
   */
  variant?: 'inline' | 'pill'
}

/**
 * `<WorkItemRefCell>` — the single source of truth for rendering a work-item
 * reference: the type glyph followed by `KEY: Title`, truncated with the full
 * text on hover (Broadcom Rally parity). Shared by every grid (inline variant)
 * and every detail sidebar (pill variant) so a work-item reference renders
 * identically everywhere. Stops click propagation so it opens the referenced
 * item, not the surrounding row.
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
    onOpen()
  }

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={open}
        title={label}
        className="flex w-full items-center gap-1.5 truncate rounded px-2.5 py-1.5 text-[12px] hover:bg-slate-50"
        style={{ border: '1px solid #d7dde7', color: BRAND.primaryLight, cursor: 'pointer' }}
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
      className="inline-flex max-w-full items-center gap-1.5 border-none bg-transparent p-0"
      style={{ cursor: 'pointer' }}
      onMouseOver={(e) => {
        e.currentTarget.style.textDecoration = 'underline'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.textDecoration = 'none'
      }}
    >
      <TypeBadge type={type} size={16} />
      <span className="truncate" style={{ fontSize: 11, color: BRAND.primaryLight }}>
        {label}
      </span>
    </button>
  )
}
