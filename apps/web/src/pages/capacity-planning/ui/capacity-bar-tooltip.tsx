import { useTranslation } from 'react-i18next'

import { CAPACITY_SEGMENTS } from '@/shared/ui/composite-bar'
import { pctOfCapacity } from '@/features/capacity-planning/plan-totals'

/**
 * Rally's bar tooltip: the four bands named, with a swatch, a value and a percentage each.
 *
 *     ■ Complete    328  69%
 *     ■ Rollup      328  69%
 *     ▨ Estimated   345  73%
 *     ▨ Capacity    469  base
 *
 * It is the bar's legend, so it has to carry the SWATCHES — a row of numbers alone leaves the reader
 * matching values to bands by length. They come from `CAPACITY_SEGMENTS`, the same source the bar
 * paints from, so the legend cannot describe colours the bar no longer uses.
 *
 * Capacity reads `base`, not `100%`: it is the denominator the other three are percentages of.
 * Percentages disappear entirely when no capacity is entered — there is nothing to be a share of,
 * and inventing one would imply a ceiling nobody set.
 */
export function CapacityBarTooltip({
  complete,
  rollup,
  estimated,
  capacity,
}: {
  complete: number
  rollup: number
  estimated: number
  capacity: number | null
}) {
  const { t } = useTranslation('capacity')

  const rows = [
    { key: 'complete', segment: CAPACITY_SEGMENTS.complete, value: complete },
    { key: 'rollup', segment: CAPACITY_SEGMENTS.rollup, value: rollup },
    { key: 'estimated', segment: CAPACITY_SEGMENTS.estimated, value: estimated },
  ] as const

  return (
    <span className="block w-44">
      {rows.map(({ key, segment, value }) => {
        const pct = pctOfCapacity(value, capacity)
        return (
          <span key={key} className="flex items-center gap-1.5 py-px">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: segment.fill, border: `1px solid ${segment.border}` }}
            />
            <span className="flex-1">{t(`breakdown.${key}`)}</span>
            <span className="tabular-nums">{value}</span>
            <span className="w-9 text-right tabular-nums opacity-70">
              {pct === null ? '' : `${pct}%`}
            </span>
          </span>
        )
      })}
      <span className="flex items-center gap-1.5 py-px">
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{
            background: CAPACITY_SEGMENTS.capacity.fill,
            border: `1px solid ${CAPACITY_SEGMENTS.capacity.border}`,
          }}
        />
        <span className="flex-1">{t('breakdown.capacity')}</span>
        <span className="tabular-nums">{capacity === null ? '—' : capacity}</span>
        <span className="w-9 text-right opacity-70">
          {capacity === null ? '' : t('summary.base')}
        </span>
      </span>
    </span>
  )
}
