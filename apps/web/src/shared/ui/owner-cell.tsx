import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'

interface OwnerCellProps {
  name?: string | null
  /** Extra classes merged onto the wrapper. */
  className?: string
}

/**
 * Owner cell: a small initials chip + truncated name, with an em-dash
 * fallback when unassigned. Previously hand-rolled identically in backlog,
 * releases-detail and milestones-detail — consolidated here.
 *
 * (Distinct from the larger dark `Avatar` used in headers/menus.)
 */
export function OwnerCell({ name, className }: OwnerCellProps) {
  if (!name) {
    return (
      <span className="text-[10px]" style={{ color: BRAND.textDisabled }}>
        —
      </span>
    )
  }

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('')

  return (
    <div className={cn('flex items-center gap-1 overflow-hidden', className)}>
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
        style={{ backgroundColor: BRAND.avatarBg, color: BRAND.avatarText }}
      >
        {initials}
      </span>
      <span className="truncate text-[10px]" style={{ color: BRAND.textSecondary }}>
        {name}
      </span>
    </div>
  )
}
