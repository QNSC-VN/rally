import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Info, Minus, Plus, Settings } from 'lucide-react'

import { RatioMeter } from '@/shared/ui/ratio-meter'
import { ActionMenu, ActionMenuItem } from '@/shared/ui/action-menu'
import { IconButton } from '@/shared/ui/icon-button'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import type { AcceptedChildren } from '../api'

/** The per-type slice this panel reads, in either unit. */
type Slice = { points: number; count: number; acceptedPoints: number; acceptedCount: number }

type Metric = 'points' | 'count'

/**
 * Rally lists Defects before Stories, which is not the order the API returns. Fixed here
 * rather than in the service: it is a presentation decision, and pinning it to an explicit
 * list also means a new child type cannot silently appear in an arbitrary position.
 */
const TYPE_ORDER = ['defect', 'story'] as const

function readDefaultMetric(): Metric {
  return localStorage.getItem(STORAGE_KEYS.ACCEPTED_CHILDREN_UNIT) === 'count' ? 'count' : 'points'
}

/**
 * "Total Accepted Children" — the panel real Rally puts at the TOP of a portfolio item's
 * Details pane, above the Description.
 *
 * Replaces the four bare progress meters this page used to show lower down. Rally frames the
 * same arithmetic as ONE question — how much of this item's child work has been accepted — in a
 * single framed strip: the meter, the unit selector, and a +/− toggle that reveals the per-type
 * breakdown beside it behind a divider. The numbers are unchanged; the framing, the position and
 * the chrome are what the reader was missing.
 *
 * Collapsed by default, matching Rally: the total is the headline and the breakdown is the
 * detail you ask for. The unit toggle switches Points ↔ Count with no refetch, because the API
 * sends both metrics on the detail response (see `AcceptedChildrenRollup`). A toggle that
 * round-tripped would make the two units look like separate queries over different data.
 *
 * The gear is Rally's, and it does what Rally's does: it holds the panel's per-user DISPLAY
 * preference — which unit to open in — persisted to localStorage. That is why it is a gear and
 * not a kebab: a gear promises "how this looks", which is all it changes.
 */
export function AcceptedChildrenBlock({ data }: { data: AcceptedChildren }) {
  const { t } = useTranslation('portfolio')
  const [defaultMetric, setDefaultMetric] = useState<Metric>(readDefaultMetric)
  const [metric, setMetric] = useState<Metric>(defaultMetric)
  const [expanded, setExpanded] = useState(false)

  function chooseDefault(next: Metric) {
    localStorage.setItem(STORAGE_KEYS.ACCEPTED_CHILDREN_UNIT, next)
    setDefaultMetric(next)
    // Apply it immediately as well — a preference that only takes effect on the next page
    // load reads as a broken control.
    setMetric(next)
  }

  const pick = (g: Slice) =>
    metric === 'points'
      ? { accepted: g.acceptedPoints, total: g.points }
      : { accepted: g.acceptedCount, total: g.count }

  const ratio = (accepted: number, all: number) => (all > 0 ? accepted / all : null)
  const total = pick(data.total)

  const groups = TYPE_ORDER.map((type) => data.byType.find((g) => g.type === type)).filter(
    (g): g is AcceptedChildren['byType'][number] => !!g,
  )

  return (
    /* `w-fit` on the column, so the header row is exactly as wide as the framed strip below
       it — that is what puts the gear and info at the STRIP's right edge rather than floating
       off at the far side of the pane. */
    <div className="flex w-fit flex-col">
      <div className="flex items-center justify-between gap-6">
        <span className="text-ui-md font-semibold text-muted-foreground">
          {t('detail.acceptedChildren.heading')}
        </span>
        <div className="flex items-center gap-0.5">
          <ActionMenu
            ariaLabel={t('detail.acceptedChildren.settings')}
            icon={<Settings size={13} />}
          >
            {(['points', 'count'] as const).map((m) => (
              <ActionMenuItem
                key={m}
                icon={
                  defaultMetric === m ? (
                    <Check size={13} />
                  ) : (
                    <span className="inline-block w-[13px]" />
                  )
                }
                label={t(`detail.acceptedChildren.defaultUnit.${m}`)}
                onClick={() => chooseDefault(m)}
              />
            ))}
          </ActionMenu>
          <span
            className="p-1.5 text-primary-light"
            title={t('detail.acceptedChildren.help')}
            aria-label={t('detail.acceptedChildren.help')}
          >
            <Info size={13} />
          </span>
        </div>
      </div>

      {/* ONE framed strip holds the meter, the unit, the toggle and the breakdown — Rally draws
          a single box, not a box per part. `w-fit` so it hugs its contents and grows only when
          the breakdown opens, which is what makes the collapsed state read as compact. */}
      <div className="flex w-fit items-center gap-2 rounded-sm border border-border bg-card px-2 py-1">
        <div className="flex w-44 items-center">
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

        <div className="w-[74px] shrink-0">
          <SearchableSelect
            variant="field"
            dense
            value={metric}
            ariaLabel={t('detail.acceptedChildren.unit')}
            options={[
              { value: 'points', label: t('detail.acceptedChildren.points') },
              { value: 'count', label: t('detail.acceptedChildren.count') },
            ]}
            onChange={(v) => setMetric(v as Metric)}
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

        {/* A divider, then the per-type figures — still inside the same strip. Both types always
            render, zero-filled: Rally shows "Defects: 0% 0/0" rather than dropping the entry,
            because a missing entry reads as "this cannot have defects". */}
        {expanded && (
          <>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
            <div className="flex items-center gap-3">
              {groups.map((g) => {
                const { accepted, total: all } = pick(g)
                const r = ratio(accepted, all)
                return (
                  <span
                    key={g.type}
                    className="flex items-center gap-1 text-ui-xs whitespace-nowrap"
                  >
                    <span className="font-semibold text-warning">
                      {t(`detail.acceptedChildren.types.${g.type}`)}:
                    </span>
                    <span className="font-semibold text-warning tabular-nums">
                      {r === null ? '0%' : `${Math.round(r * 100)}%`}
                    </span>
                    <span className="font-mono text-foreground-subtle tabular-nums">
                      {accepted}/{all}
                    </span>
                  </span>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
