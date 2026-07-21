import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'

/** Colour tone for the chip. `project` is the default navy-on-tint; `muted` is the low-emphasis grey team key. */
export type KeyChipTone = 'project' | 'muted'
/** `md` for grid rows, `sm` for the compact sidebar tree. */
export type KeyChipSize = 'sm' | 'md'

const TONE: Record<KeyChipTone, { bg: string; text: string }> = {
  project: { bg: BRAND.avatarBg, text: BRAND.primary },
  muted: { bg: BRAND.borderInner, text: BRAND.textSecondary },
}

/**
 * Monospace key chip — the small rounded square that shows a Project or Team
 * key (e.g. "NXP", "ALPHA"). Single source of truth for the glyph so the
 * Backlog/Projects grids, the workspace-switcher tree and the Home dashboard
 * all render the key identically. Replaces the hand-rolled
 * `rounded-sm font-mono …` spans previously duplicated per surface.
 */
export function KeyChip({
  children,
  size = 'md',
  tone = 'project',
  className,
}: {
  children: ReactNode
  size?: KeyChipSize
  tone?: KeyChipTone
  className?: string
}) {
  const { bg, text } = TONE[tone]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm font-mono whitespace-nowrap',
        size === 'sm'
          ? 'h-4 min-w-8 px-1 text-ui-2xs font-bold'
          : 'h-5 px-1.5 text-ui-xs font-semibold',
        className,
      )}
      style={{ backgroundColor: bg, color: text }}
    >
      {children}
    </span>
  )
}
