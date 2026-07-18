import type { ReactNode } from 'react'

import { BRAND } from '@/shared/config/brand'

/**
 * Shared page header bar — the single source of truth for the top bar on pages
 * that are NOT grid pages (grid pages use {@link PageToolbar}).
 *
 * It deliberately mirrors the `PageToolbar` bar metrics — `px-4 py-2`, a
 * `13px` semibold title and a subtle bottom border — so that every page's
 * header lines up at the exact same height and left/right edge. Navigating
 * between pages then keeps the title, and the content below it, on a stable
 * baseline instead of shifting a few pixels per screen.
 *
 * Layout: `[icon] Title [badge]  ·  subtitle` on the left, `actions` on the
 * far right. Every slot is optional so each page keeps its own content while
 * the frame stays consistent.
 */
export function PageHeader({
  title,
  icon,
  badge,
  subtitle,
  actions,
}: {
  /** Page title, rendered bold on the far left. */
  title: string
  /** Optional leading icon rendered before the title. */
  icon?: ReactNode
  /** Optional accessory rendered right after the title (e.g. a count pill). */
  badge?: ReactNode
  /** Optional secondary text shown inline after a divider (e.g. context). */
  subtitle?: ReactNode
  /** Optional controls pushed to the far right (pickers, buttons, tabs). */
  actions?: ReactNode
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-3 px-4 py-2"
      style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}` }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <h1 className="shrink-0 text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
          {title}
        </h1>
        {badge}
        {subtitle != null && (
          <>
            <div className="h-4 w-px shrink-0" style={{ backgroundColor: BRAND.border }} />
            <div className="truncate text-[11px]" style={{ color: BRAND.textSecondary }}>
              {subtitle}
            </div>
          </>
        )}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
