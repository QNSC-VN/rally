import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import {
  useUpdatePortfolioItem,
  type PortfolioItem,
  type PortfolioItemState,
} from '@/features/portfolio/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { ProgressBar } from '@/shared/ui/progress-bar'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { RowGutter } from '@/shared/ui/row-gutter'
import { BRAND } from '@/shared/config/brand'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import { type ColKey } from '../model/columns'
import { PORTFOLIO_STATES } from '../model/portfolio-states'

/**
 * One Portfolio grid row.
 *
 * Name and State edit in place; everything else is display-only here and edited on the
 * detail page. `canEdit` is decided per ROW rather than per page: this list is
 * cross-project, so the answer differs between rows and a page-level flag would either
 * hide actions the user has elsewhere or offer ones they do not.
 *
 * The row owns its dnd-kit wiring (`useSortable`) and therefore renders its OWN
 * `RowGutter` from the scaffold's `gutterProps` — only the row holds the activator ref
 * and drag listeners, so the scaffold's ready-made `gutter` node cannot carry them.
 */
export function PortfolioRow({
  item,
  canEdit,
  canRank,
  colStyleFor,
  gutterProps,
  onOpen,
}: {
  item: PortfolioItem
  canEdit: boolean
  /** Drag-to-rank enabled: requires edit rights AND natural rank order. */
  canRank: boolean
  colStyleFor: (key: ColKey, base?: CSSProperties) => CSSProperties
  /** Gutter configuration from the list scaffold; the row renders the gutter itself. */
  gutterProps: {
    stopPropagation: true
    checkbox?: { checked: boolean; onChange: () => void; ariaLabel: string }
  }
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('portfolio')
  const { progress, rollup } = item
  const update = useUpdatePortfolioItem()
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  function save(patch: Parameters<typeof update.mutate>[0]['patch'], success: string) {
    update.mutate(
      { id: item.id, patch },
      { onSuccess: () => notify.success(success), onError: (err) => notify.error(err.message) },
    )
  }

  return (
    <div
      ref={setNodeRef}
      className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        backgroundColor: isDragging ? BRAND.primaryLighter : undefined,
        opacity: isDragging ? 0.6 : 1,
        // Lift the dragged row above its neighbours so it is not clipped mid-drag.
        zIndex: isDragging ? 1 : undefined,
        position: isDragging ? 'relative' : undefined,
      }}
      {...attributes}
    >
      <RowGutter
        ref={setActivatorNodeRef}
        dragListeners={listeners}
        dragDisabled={!canRank}
        {...gutterProps}
      />

      {/* ID — the same TypeBadge + key cell as US/DE/RE, now carrying EP-/FE- */}
      <div style={colStyleFor('id', { flexShrink: 0 })} className="flex items-center px-2">
        <IdCell type={item.type} itemKey={item.itemKey} onOpen={() => onOpen(item.id)} />
      </div>

      <div
        style={colStyleFor('name', { flexShrink: 0 })}
        className="min-w-0 px-0"
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          fullCell
          value={item.name}
          canEdit={canEdit}
          onCommit={(v) => {
            const next = v.trim()
            if (next && next !== item.name) save({ name: next }, t('row.nameUpdated'))
          }}
          ariaLabel={t('columns.name')}
          title={item.name}
          className="block w-full truncate text-foreground"
        />
      </div>

      <div
        style={colStyleFor('state', { flexShrink: 0 })}
        className="min-w-0 px-0"
        onClick={(e) => e.stopPropagation()}
      >
        <SearchableSelect
          variant="cell"
          value={item.state}
          readOnly={!canEdit}
          ariaLabel={t('filters.state')}
          options={PORTFOLIO_STATES.map((s) => ({ value: s, label: t(`states.${s}`) }))}
          onChange={(v) => {
            if (v && v !== item.state)
              save({ state: v as PortfolioItemState }, t('row.stateUpdated'))
          }}
        />
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
