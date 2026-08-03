import { AlertTriangle } from 'lucide-react'
import type { CSSProperties } from 'react'

import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'

export interface WarningIndicatorProps {
  /**
   * Already-translated sentences, in the order they should be read.
   *
   * Sentences rather than codes because `shared/ui` must not reach into a feature's copy —
   * the caller resolves them (`useCapacityWarningText` for capacity). An EMPTY list renders
   * nothing, so callers can pass a list straight through without guarding.
   */
  labels: readonly string[]
  /**
   * Whether this glyph carries `labels` as its ACCESSIBLE NAME (default) or is decoration.
   *
   * `false` only where the same sentences are already named on the same row — two nodes with
   * one accessible name make a screen reader read the reason twice. The glyph still draws,
   * because its position often carries the information.
   */
  announce?: boolean
  size?: number
  className?: string
  style?: CSSProperties
}

/**
 * The ONE warning glyph: a red triangle that always carries its reasons.
 *
 * Four surfaces drew this by hand and disagreed on both counts. The composite bar and the
 * Features tab used a red `AlertTriangle`; `team-capacity-rail` used an AMBER one for the very
 * same team warnings, so the identical rule looked like two different severities depending on
 * which panel you read it in; and `plan-summary-metrics` printed a bare Unicode `⚠` with no
 * `role`, no `aria-label` and no `title` — visible trouble a screen reader could not see and a
 * mouse user could not explain.
 *
 * Red, always, because these are the states the BA asks a planner to act on. An amber tier used
 * to exist for `load_above_target` — a team inside capacity but past its advisory load ceiling —
 * and that rule is gone with `capacity_plans.target_load_pct`; nothing left in the set is
 * advisory-only, so a second severity would be a distinction without a difference.
 *
 * `title` AND `aria-label` both, from the same array: `title` is what a mouse user gets on hover,
 * `aria-label` what a screen reader announces. The name goes on a wrapping span rather than the
 * SVG because `title` is an HTML attribute React's SVG typings reject.
 */
export function WarningIndicator({
  labels,
  announce = true,
  size = 12,
  className,
  style,
}: WarningIndicatorProps) {
  if (labels.length === 0) return null

  return (
    <span
      {...(announce ? { role: 'img', 'aria-label': labels.join('. ') } : { 'aria-hidden': true })}
      title={labels.join('\n')}
      className={cn('flex items-center', className)}
      style={style}
    >
      <AlertTriangle size={size} style={{ color: BRAND.danger }} />
    </span>
  )
}
