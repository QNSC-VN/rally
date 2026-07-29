import { type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { type PortfolioItem } from '@/features/portfolio/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { ProgressBar } from '@/shared/ui/progress-bar'
import { type ColKey } from '../model/columns'

/**
 * One Portfolio grid row.
 *
 * Read-only: creating, editing, ranking and archiving portfolio items land in a
 * later slice, so this deliberately does NOT use `InlineEditableCell`. Adding it
 * now would render editable-looking cells with no mutation behind them.
 */
export function PortfolioRow({
  item,
  colStyleFor,
  gutter,
  onOpen,
}: {
  item: PortfolioItem
  colStyleFor: (key: ColKey, base?: CSSProperties) => CSSProperties
  /** Selection gutter node supplied by the list scaffold. */
  gutter: ReactNode
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('portfolio')
  const { progress, rollup } = item

  return (
    <div className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter">
      {gutter}

      {/* ID — the same TypeBadge + key cell as US/DE/RE, now carrying EP-/FE- */}
      <div style={colStyleFor('id', { flexShrink: 0 })} className="flex items-center px-2">
        <IdCell type={item.type} itemKey={item.itemKey} onOpen={() => onOpen(item.id)} />
      </div>

      <div style={colStyleFor('name', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="block truncate text-foreground" title={item.name}>
          {item.name}
        </span>
      </div>

      <div style={colStyleFor('state', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-muted-foreground">
          {t(`states.${item.state}`, { defaultValue: item.state })}
        </span>
      </div>

      <div style={colStyleFor('parent', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-muted-foreground" title={item.parentKey ?? undefined}>
          {item.parentKey ?? '—'}
        </span>
      </div>

      <div style={colStyleFor('release', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-muted-foreground" title={item.releaseName ?? undefined}>
          {item.releaseName ?? '—'}
        </span>
      </div>

      {/* Percent Done by Plan Estimate — accepted points over rolled-up points. */}
      <div style={colStyleFor('percentDonePoints', { flexShrink: 0 })} className="min-w-0 px-2">
        <ProgressBar
          ratio={progress.percentDoneByPlanEstimate}
          title={t('row.pointsTooltip', {
            accepted: rollup.acceptedPoints,
            total: rollup.rollupPoints,
          })}
        />
      </div>

      {/* Percent Done by Count — accepted children over total children. */}
      <div style={colStyleFor('percentDoneCount', { flexShrink: 0 })} className="min-w-0 px-2">
        <ProgressBar
          ratio={progress.percentDoneByCount}
          title={t('row.countTooltip', {
            accepted: rollup.acceptedCount,
            total: rollup.rollupCount,
          })}
        />
      </div>

      {/* The estimate the progress columns divide by: refined if set, else the
          workspace mapping of the preliminary T-shirt size. */}
      <div
        style={colStyleFor('estimate', { flexShrink: 0 })}
        className="min-w-0 px-2 text-right text-muted-foreground"
      >
        {item.refinedEstimate ??
          t(`sizes.${item.preliminaryEstimate}`, {
            defaultValue: item.preliminaryEstimate,
          })}
      </div>

      <div style={colStyleFor('project', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-muted-foreground">{item.projectName ?? '—'}</span>
      </div>

      <div style={colStyleFor('team', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-muted-foreground" title={item.teamName ?? undefined}>
          {item.teamName ?? '—'}
        </span>
      </div>

      <div style={colStyleFor('owner', { flexShrink: 0 })} className="min-w-0 px-2">
        <OwnerCell name={item.ownerName} />
      </div>
    </div>
  )
}
