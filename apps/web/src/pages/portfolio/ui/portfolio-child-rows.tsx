/**
 * The child rows revealed under an expanded Portfolio row.
 *
 * Two levels, one component, because the disclosure is the SAME affordance in both
 * cases and only the child shape differs (Rally's Portfolio Item tree):
 *   • an Epic discloses its child **Features**   → `usePortfolioChildFeatures`
 *   • a Feature discloses its linked **Stories / Defects** → `usePortfolioChildren`
 *
 * Modelled on Iteration Status' expanded child Tasks: the same shared
 * `RowExpandToggle` in the parent's ID cell, the same dashed child-row divider, the
 * same 2px hierarchy rail drawn as an INSET SHADOW rather than a left border — a
 * border would push every child cell 2px right and break alignment with the sticky
 * header. Child cells reuse the parent's `colStyleFor`, so resizing, reordering or
 * hiding a column moves the child cells with it for free.
 *
 * Mounted only while expanded, which is also what gates the fetch: both hooks are
 * `enabled` on a defined id, so an unmounted child list never queries. No page-level
 * expanded-id registry is needed.
 */
import { useTranslation } from 'react-i18next'
import { type CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'

import {
  usePortfolioChildFeatures,
  usePortfolioChildren,
  type PortfolioItem,
} from '@/features/portfolio/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { ScheduleState, SCHEDULE_STATE_LABEL } from '@/entities/work-item/model/types'
import { PercentDoneBar } from '@/features/portfolio/ui/percent-done-bar'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { TeamCell } from '@/shared/ui/team-cell'
import { RowGutter } from '@/shared/ui/row-gutter'
import { Spinner } from '@/shared/ui/spinner'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { type ColKey } from '../model/columns'
import { ReleaseCell } from './release-cell'

type ColStyleFor = (key: ColKey, base?: CSSProperties) => CSSProperties

/**
 * One child row shell — the leading gutter that makes the child's cells line up under
 * the parent's columns, then the caller's cells.
 *
 * Padding (`px-3`) and the gutter deliberately match `PortfolioRow` exactly; that pair
 * is what keeps a child cell under its own column heading. The dashed divider and
 * smaller type are the only intentional differences, marking the row as subordinate.
 */
function ChildRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center border-b border-dashed border-border-subtle px-3 text-ui-xs text-muted-foreground hover:bg-primary-lighter">
      {/* Mirrors the parent's gutter through the shared component (inert here — a child
          is not selectable and not rankable) so column 1 starts at the same x. */}
      <RowGutter dragDisabled />
      {children}
    </div>
  )
}

export function PortfolioChildRows({
  item,
  colStyleFor,
}: {
  item: PortfolioItem
  /** The parent grid's resolved per-column style, so child cells track column layout. */
  colStyleFor: ColStyleFor
}) {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const isEpic = item.type === 'epic'

  // Only one of the two fires: the other is handed `undefined` and stays disabled.
  const features = usePortfolioChildFeatures(isEpic ? item.id : undefined)
  const children = usePortfolioChildren(isEpic ? undefined : item.id)
  const { isLoading } = isEpic ? features : children

  const openPortfolioItem = (id: string) =>
    void navigate({ to: '/portfolio/$itemId', params: { itemId: id } })
  const openWorkItem = (itemKey: string) =>
    void navigate({ to: '/item/$itemKey', params: { itemKey } })

  const rows = isEpic
    ? (features.data ?? []).map((f) => (
        <ChildRow key={f.id}>
          <div className={`flex items-center pr-2 ${NESTED_ROW_INDENT}`} style={colStyleFor('id')}>
            <IdCell type={f.type} itemKey={f.itemKey} onOpen={() => openPortfolioItem(f.id)} />
          </div>
          <div className="min-w-0 px-2" style={colStyleFor('name')}>
            <span className="block truncate text-foreground" title={f.name}>
              {f.name}
            </span>
          </div>
          <div className="min-w-0 truncate px-2" style={colStyleFor('state')}>
            {t(`states.${f.state}`, { defaultValue: f.state })}
          </div>
          {/* Parent is the Epic this row is nested under — repeating it per child is noise. */}
          <div className="px-2" style={colStyleFor('parent')} />
          <div
            className="flex min-w-0 items-center overflow-hidden px-0"
            style={colStyleFor('release')}
          >
            <ReleaseCell
              releaseId={f.releaseId}
              releaseName={f.releaseName}
              ariaLabel={t('detail.fields.release')}
            />
          </div>
          {/* A child Feature carries its OWN rollup, so both progress bars are real here. */}
          <div className="min-w-0 px-2" style={colStyleFor('percentDonePoints')}>
            <PercentDoneBar
              metric="points"
              health={f.health}
              progress={f.progress}
              rollup={f.rollup}
            />
          </div>
          <div className="min-w-0 px-2" style={colStyleFor('percentDoneCount')}>
            <PercentDoneBar
              metric="count"
              health={f.health}
              progress={f.progress}
              rollup={f.rollup}
            />
          </div>
          <div className="min-w-0 px-2 text-right" style={colStyleFor('estimate')}>
            {f.refinedEstimate ??
              t(`sizes.${f.preliminaryEstimate}`, { defaultValue: f.preliminaryEstimate })}
          </div>
          <div className="min-w-0 truncate px-2" style={colStyleFor('project')}>
            {f.projectName ?? '—'}
          </div>
          <div className="min-w-0 px-2" style={colStyleFor('team')}>
            <TeamCell name={f.teamName} />
          </div>
          <div className="min-w-0 px-2" style={colStyleFor('owner')}>
            <OwnerCell name={f.ownerName} />
          </div>
        </ChildRow>
      ))
    : (children.data ?? []).map((c) => (
        <ChildRow key={c.id}>
          <div className={`flex items-center pr-2 ${NESTED_ROW_INDENT}`} style={colStyleFor('id')}>
            <IdCell type={c.type} itemKey={c.itemKey} onOpen={() => openWorkItem(c.itemKey)} />
          </div>
          <div className="min-w-0 px-2" style={colStyleFor('name')}>
            <span className="block truncate text-foreground" title={c.title}>
              {c.title}
            </span>
          </div>
          {/* Schedule state, not portfolio state — a Story lives on the work-item
              lifecycle, so it reads from the shared SCHEDULE_STATE_LABEL map. */}
          <div className="min-w-0 truncate px-2" style={colStyleFor('state')}>
            {SCHEDULE_STATE_LABEL[c.scheduleState as ScheduleState] ?? c.scheduleState}
          </div>
          <div className="px-2" style={colStyleFor('parent')} />
          {/* No `releaseId` on the child DTO — see ReleaseCell for why that changes the
              render path but not the appearance. */}
          <div
            className="flex min-w-0 items-center overflow-hidden px-0"
            style={colStyleFor('release')}
          >
            <ReleaseCell releaseName={c.releaseName} ariaLabel={t('detail.fields.release')} />
          </div>
          {/* Percent Done is a portfolio rollup — a single Story has none, so these stay
              empty rather than showing a 0% bar that would read as "no progress". */}
          <div className="px-2" style={colStyleFor('percentDonePoints')} />
          <div className="px-2" style={colStyleFor('percentDoneCount')} />
          {/* The Estimate column holds the Story's own plan estimate in points. */}
          <div className="min-w-0 px-2 text-right" style={colStyleFor('estimate')}>
            {c.storyPoints ?? '—'}
          </div>
          <div className="min-w-0 truncate px-2" style={colStyleFor('project')}>
            {c.projectName ?? '—'}
          </div>
          <div className="min-w-0 px-2" style={colStyleFor('team')}>
            <TeamCell name={c.teamName} />
          </div>
          <div className="min-w-0 px-2" style={colStyleFor('owner')}>
            <OwnerCell name={c.ownerName} />
          </div>
        </ChildRow>
      ))

  return (
    <div className="bg-surface-hover shadow-[inset_2px_0_0_var(--primary-lighter)]">
      {isLoading ? (
        <div className="flex items-center gap-1.5 py-1.5 pl-11 text-ui-xs text-foreground-subtle">
          <Spinner size="sm" />
          {t('row.loadingChildren')}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-1.5 pl-11 text-ui-xs text-foreground-subtle">
          {isEpic ? t('row.noChildFeatures') : t('row.noChildItems')}
        </div>
      ) : (
        rows
      )}
    </div>
  )
}
