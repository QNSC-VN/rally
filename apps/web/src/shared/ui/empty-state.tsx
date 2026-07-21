/**
 * EmptyState — the canonical centered "nothing here / failed to load" block.
 *
 * Replaces the ~26 hand-rolled `flex flex-col items-center justify-center …`
 * blocks scattered across pages. Callers pass a pre-sized icon plus a title,
 * and optionally a description and an action (e.g. a "Create first…" button).
 *
 * Uses semantic token classes so the copy colour follows the `.dark` overrides.
 */
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface EmptyStateProps {
  /** A pre-sized icon element, e.g. `<PackageOpen size={32} className="text-border-strong" />`. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Optional action row (button/link) rendered under the copy. */
  action?: ReactNode
  className?: string
  /** Vertical rhythm: `md` (page bodies) or `sm` (cards / popovers). */
  size?: 'sm' | 'md'
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = 'md',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 py-12' : 'gap-3 py-20',
        className,
      )}
    >
      {icon}
      <p className="text-ui-lg font-medium text-muted-foreground">{title}</p>
      {description && <p className="text-ui-sm text-foreground-subtle">{description}</p>}
      {action}
    </div>
  )
}
