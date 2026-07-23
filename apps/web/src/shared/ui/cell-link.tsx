import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * CellLink — the shared link affordance for table/list cells whose text opens a
 * detail (milestone/release name, iteration key, …). One component so every
 * "click this text to navigate" cell reads the same (primary-light + hover
 * underline) and so grids stay link-only: the row itself never navigates, only
 * this link does. Stops propagation so it works inside rows that still carry
 * other handlers.
 */
export function CellLink({
  onClick,
  title,
  className,
  wrap = false,
  children,
}: {
  onClick: () => void
  title?: string
  className?: string
  /** When true the text wraps across lines (`break-words`) instead of the
   *  default single-line `truncate`. Used by Name columns that wrap. */
  wrap?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'block text-left text-primary-light underline-offset-2 hover:underline',
        wrap ? 'break-words whitespace-normal' : 'truncate',
        className,
      )}
    >
      {children}
    </button>
  )
}
