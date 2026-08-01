import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Minus, Plus } from 'lucide-react'

import { RatioMeter } from '@/shared/ui/ratio-meter'
import { IconButton } from '@/shared/ui/icon-button'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import type { AcceptedChildren } from '../api'

/** The per-type slice this panel reads, in either unit. */
type Slice = { points: number; count: number; acceptedPoints: number; acceptedCount: number }

/**
 * "Total Accepted Children" — the panel real Rally puts on a portfolio item's detail page,
 * laid out the way Rally lays it out.
 *
 * Replaces the four bare progress meters this page used to show. Rally frames the same
 * arithmetic as ONE question — how much of this item's child work has been accepted — on a
 * single row: the meter, the unit selector, an expand toggle, then a per-type breakdown. The
 * numbers are unchanged from the four meters; the framing is what the reader was missing.
 *
 * The unit toggle switches Points ↔ Count with no refetch, because the API sends both
 * metrics on the detail response for exactly this reason (see `AcceptedChildrenRollup`). A
 * toggle that round-tripped would make the two units look like separate queries.
 *
 * Rally's own version of this header carries a gear beside the info icon. There is no gear
 * here: Rally's opens per-user column preferences for the panel, and this panel has no
 * preferences to set — a gear that opens nothing is worse than no gear. The info icon is
 * kept because it has something to say.
 */
export function AcceptedChildrenBlock({ data }: { data: AcceptedChildren }) {
  const { t } = useTranslation('portfolio')
  const [metric, setMetric] = useState<'points' | 'count'>('points')
  // Rally ships this expanded and lets the reader collapse the per-type detail back to just
  // the total, which is what its +/- control does.
  const [expanded, setExpanded] = useState(true)

  const pick = (g: Slice) =>
    metric === 'points'
      ? { accepted: g.acceptedPoints, total: g.points }
      : { accepted: g.acceptedCount, total: g.count }

  const ratio = (accepted: number, all: number) => (all > 0 ? accepted / all : null)
  const total = pick(data.total)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-ui-md font-semibold text-muted-foreground">
          {t('detail.acceptedChildren.heading')}
        </span>
        <span className="text-primary-light" title={t('detail.acceptedChildren.help')}>
          <Info size={13} />
        </span>
      </div>

      {/* One row, as Rally has it: meter, unit, toggle, breakdown. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-96 min-w-56 flex-1 items-center">
          <RatioMeter
            ratio={ratio(total.accepted, total.total)}
            accepted={total.accepted}
            total={total.total}
            title={t('detail.acceptedChildren.tooltip', {
              accepted: total.accepted,
              total: total.total,
            })}
          />
        </div>

        <div className="w-24 shrink-0">
          <SearchableSelect
            variant="field"
            value={metric}
            ariaLabel={t('detail.acceptedChildren.unit')}
            options={[
              { value: 'points', label: t('detail.acceptedChildren.points') },
              { value: 'count', label: t('detail.acceptedChildren.count') },
            ]}
            onChange={(v) => setMetric(v as 'points' | 'count')}
          />
        </div>

        <IconButton
          size="sm"
          aria-label={
            expanded ? t('detail.acceptedChildren.collapse') : t('detail.acceptedChildren.expand')
          }
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <Minus size={12} /> : <Plus size={12} />}
        </IconButton>

        {/* Both types always render, zero-filled — Rally shows "Defects: 0% 0/0" rather than
            dropping the row, because a missing row reads as "this cannot have defects". */}
        {expanded &&
          data.byType.map((g) => {
            const { accepted, total: all } = pick(g)
            const r = ratio(accepted, all)
            return (
              <span key={g.type} className="flex items-center gap-1 text-ui-xs whitespace-nowrap">
                <span className="font-semibold text-warning">
                  {t(`detail.acceptedChildren.types.${g.type}`)}:
                </span>
                <span className="text-warning">
                  {r === null ? '0%' : `${Math.round(r * 100)}%`}
                </span>
                <span className="font-mono text-foreground-subtle tabular-nums">
                  {accepted}/{all}
                </span>
              </span>
            )
          })}
      </div>
    </div>
  )
}
