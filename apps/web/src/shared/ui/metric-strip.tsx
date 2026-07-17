import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'

export type MetricStripProps = {
  /** The metric cards (or any summary nodes) rendered left-to-right. */
  children: React.ReactNode
  /** Optional trailing content, right-aligned (e.g. a toolbar action). */
  actions?: React.ReactNode
  /** Extra classes for the strip container. */
  className?: string
}

/**
 * Canonical KPI summary strip — the 58px-tall, surface-coloured bar that sits
 * directly under a page header and holds a row of {@link MetricCard}s.
 *
 * Single source of truth for the strip chrome (height, spacing, divider) so
 * every read-model summary (Portfolio, Releases, Projects, Team Board, …)
 * stays visually identical. Pages only supply the cards.
 */
export function MetricStrip({ children, actions, className }: MetricStripProps) {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-6 px-4', className)}
      style={{
        height: 58,
        backgroundColor: BRAND.surface,
        borderBottom: `1px solid ${BRAND.border}`,
      }}
    >
      {children}
      {actions != null && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}
