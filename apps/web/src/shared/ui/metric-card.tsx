import { BRAND } from '@/shared/config/brand'

export type MetricCardProps = {
  /** Small uppercase label above the value. */
  label: string
  /** The headline value (e.g. "42%", "Done", a day count). */
  value: React.ReactNode
  /** Value colour — defaults to the Rally navy. */
  valueColor?: string
  /** Muted caption shown next to the value (e.g. "16 of 13 Points"). */
  caption?: React.ReactNode
  /** Optional progress bar, 0–100. Omit to hide the bar. */
  progressPct?: number
  /** Progress fill colour — defaults to the value colour / navy. */
  progressColor?: string
  /** Minimum card width in px (keeps the strip evenly spaced). */
  minWidth?: number
}

/**
 * Compact KPI card used in the tracking metric strips (Iteration Status,
 * and reusable for any Rally read-model summary). Encapsulates the
 * label / big-number / caption / progress-bar layout so every strip stays
 * visually consistent.
 */
export function MetricCard({
  label,
  value,
  valueColor,
  caption,
  progressPct,
  progressColor,
  minWidth = 150,
}: MetricCardProps) {
  const color = valueColor ?? BRAND.primary
  return (
    <div className="flex flex-col justify-center" style={{ minWidth }}>
      <span
        className="mb-1 text-ui-xs font-semibold text-foreground-subtle uppercase"
        style={{ letterSpacing: '0.5px' }}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl leading-none font-bold tabular-nums" style={{ color }}>
          {value}
        </span>
        {caption != null && <span className="text-ui-sm text-muted-foreground">{caption}</span>}
      </div>
      {progressPct != null && (
        <div className="mt-1.5 h-1 w-[120px] overflow-hidden rounded-full bg-border-subtle">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(Math.max(progressPct, 0), 100)}%`,
              backgroundColor: progressColor ?? color,
            }}
          />
        </div>
      )}
    </div>
  )
}
