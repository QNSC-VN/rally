import { cn } from '@/shared/lib/utils'
import { formatNumber, formatWholePercent } from '@/shared/lib/utils'

/**
 * A number with its percentage beside it, as Rally writes every capacity figure: `328 69%`.
 *
 * The percentage is small and muted because the NUMBER is the fact and the percentage is context —
 * Rally sizes them that way, and a same-size pair reads as two competing values.
 *
 * `null` percent renders the number alone rather than `—%`: a Feature row has no capacity to be a
 * percentage OF, and inventing 100% would claim it exactly fills a ceiling nobody set.
 */
export function MetricValue({
  value,
  pct,
  className,
}: {
  value: number
  /** Percentage of the row's base, or null when there is no base to measure against. */
  pct: number | null
  className?: string
}) {
  return (
    // `font-mono` alongside `tabular-nums`: both are needed for digits to line up in a
    // column, and this component is every capacity grid's numeric cell, so omitting it
    // left them all subtly ragged. Matches the shared table cell's contract.
    <span className={cn('inline-flex items-baseline gap-1 font-mono tabular-nums', className)}>
      <span className="text-foreground">{formatNumber(value)}</span>
      {pct !== null && (
        <span className="text-ui-xs text-foreground-subtle">{formatWholePercent(pct)}</span>
      )}
    </span>
  )
}
