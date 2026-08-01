import { type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { IdCell } from '@/entities/work-item/ui/id-cell'
import { MetricValue } from '@/shared/ui/metric-value'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'
import type { CapacityPlanItem } from '@/features/capacity-planning/api'
import { EstimateTierIcon } from './estimate-tier-badge'
import { CapacityItemActions } from './capacity-item-actions'
import { type ItemColKey } from '../model/columns'

/**
 * One Feature on Rally's Items tab.
 *
 * The item-level counterpart to `AllocationRow`, which shows one team's slice. Both exist
 * because Rally reports a Feature's rollup ONCE on this tab while the team grid attributes it
 * per team — the same Feature legitimately shows different numbers on the two surfaces, and the
 * row that says which is which is the one the reader is looking at.
 *
 * Reuses `IdCell`, `CompositeBar` and `EstimateTierBadge` so a Feature reads identically here,
 * on the team grid, and on the Portfolio page.
 */
export function CapacityItemRow({
  item,
  position,
  primaryTeamName,
  belowCutline,
  expanded = false,
  onToggleExpanded,
  onRemove,
  onUnassign,
  onAllocate,
  onMove,
  onAssign,
  assignOptions = [],
  dragHandle,
  colStyleFor,
  onOpenFeature,
}: {
  item: CapacityPlanItem
  /** 1-based rank position within this plan — the order the cutline accumulates down. */
  position: number
  /** Name of the team that owns this Feature, resolved by the page from the plan's teams. */
  primaryTeamName: string | null
  /** Below the plan's cutline: this Feature does not fit the plan's total capacity. */
  belowCutline: boolean
  /** Whether this Feature's per-team rows are showing. */
  expanded?: boolean
  /** Omitted where nothing can be nested — the toggle then renders as a spacer. */
  onToggleExpanded?: () => void
  /** Removes the Feature from the plan. Omitted for a reader without `capacity:manage`. */
  onRemove?: () => void
  /** Clears every team assignment but keeps the Feature on the plan — Rally's second removal verb. */
  onUnassign?: () => void
  /** Opens the Allocate dialog for THIS Feature — splitting it across teams. */
  onAllocate?: () => void
  /** Opens Rally's `Move To Another Plan` for THIS Feature. */
  onMove?: () => void
  /**
   * Assigns the Feature to one team, or to none. Omitted where the reader cannot manage the plan,
   * which turns the cell back into text.
   */
  onAssign?: (teamId: string | null) => void
  /** Teams on the plan, plus `Unassign` — built once by the page. */
  assignOptions?: { value: string; label: string }[]
  /** The rank grip, rendered by the page so the row need not know about dnd-kit. */
  dragHandle?: ReactNode
  colStyleFor: (key: ItemColKey, base?: CSSProperties) => CSSProperties
  onOpenFeature: (portfolioItemId: string) => void
}) {
  const { t } = useTranslation('capacity')

  return (
    <div
      className={cn(
        'group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter',
        // Dimmed, not hidden: the commitment is real and still editable, and Rally's line
        // informs rather than gates.
        belowCutline && 'opacity-60',
      )}
      data-below-cutline={belowCutline || undefined}
    >
      {/* Rank + grip. Rally ranks by dragging the row and only "when the grid is set to the default
          sort order", which is the plan's own rank order — the same rule `useRowRerank` enforces on
          the Backlog, so the grip simply disappears under any other sort. */}
      <div
        style={colStyleFor('rank', { flexShrink: 0 })}
        className="flex items-center justify-end gap-1 px-2 text-muted-foreground tabular-nums"
      >
        {dragHandle}
        {position}
      </div>

      <div style={colStyleFor('id', { flexShrink: 0 })} className="min-w-0 px-2">
        <IdCell
          itemKey={item.itemKey}
          type="feature"
          onOpen={() => onOpenFeature(item.portfolioItemId)}
        />
      </div>

      <div
        style={colStyleFor('name', { flexShrink: 0 })}
        className="flex min-w-0 items-center gap-1 px-2"
      >
        {/* Disclosed only when there IS something nested: a Feature on one team has no breakdown to
            show, and an inert toggle on every row teaches the reader to ignore all of them. */}
        {onToggleExpanded !== undefined && item.teamIds.length > 1 ? (
          <RowExpandToggle
            expanded={expanded}
            onToggle={onToggleExpanded}
            label={
              expanded
                ? t('items.collapseTeams', { item: item.itemKey })
                : t('items.expandTeams', { item: item.itemKey })
            }
          />
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="truncate text-foreground" title={item.name}>
          {item.name}
        </span>
      </div>

      {/* Rally's `Project`: where this Feature lives OUTSIDE the plan. Distinct from the planned
          assignment beside it — a Story-to-Feature link may cross projects, so a plan can carry a
          Feature owned elsewhere, and a planner needs to see that before allocating to it. */}
      <div style={colStyleFor('project', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-muted-foreground" title={item.projectName ?? undefined}>
          {item.projectName ?? '—'}
        </span>
      </div>

      <div style={colStyleFor('assignment', { flexShrink: 0 })} className="min-w-0 px-2">
        {/* Rally's Planned Team Assignment: the team(s) this Feature is planned against in THIS
            plan. Unassigned carries a warning — it is demand with nowhere to go, and Rally flags
            it the same way. Allocated to SEVERAL teams, Rally shows the COUNT rather than one
            team's name, because no single name would be the answer; the nested rows below say
            which teams they are. */}
        {item.teamIds.length <= 1 && onAssign !== undefined ? (
          /* Rally: "You can select the project from this field to assign a portfolio item to a
             single project." A SPLIT Feature is read-only here — no single team is the answer, and
             Rally sends those edits through the Allocate dialog. The BA adds `Unassign` as the
             first option, which is the only way back to the yellow unassigned state. */
          <SearchableSelect
            value={item.primaryTeamId ?? ''}
            ariaLabel={t('items.assignmentLabel', { item: item.itemKey })}
            options={assignOptions}
            onChange={(v) => onAssign(v === '' || v === null ? null : v)}
            /* The trigger says `Not assigned`, in the BA's yellow, while the MENU offers `Unassign`.
               They are the same row of the list but not the same sentence: one is a state the plan is
               in, the other an action you can take — and without this the cell rendered the option's
               own label, so an unassigned Feature read as the verb "Unassign". */
            triggerContent={
              item.primaryTeamId === null ? (
                <span className="flex items-center gap-1" style={{ color: BRAND.warning }}>
                  <AlertTriangle size={12} />
                  <span className="text-ui-sm">{t('items.notAssigned')}</span>
                </span>
              ) : undefined
            }
          />
        ) : item.primaryTeamId === null && item.teamIds.length === 0 ? (
          <span className="flex items-center gap-1" style={{ color: BRAND.warning }}>
            <AlertTriangle size={12} />
            <span className="text-ui-sm">{t('items.notAssigned')}</span>
          </span>
        ) : item.teamIds.length > 1 ? (
          /* Rally prints a boxed COUNT here and lists the teams in the nested rows beneath. A count
             is the only honest answer for a split Feature — no single team name is it. */
          <span
            className="inline-flex min-w-6 justify-center rounded-sm border border-border-strong px-1 text-ui-sm text-foreground tabular-nums"
            title={t('items.teamCount', { count: item.teamIds.length })}
          >
            {item.teamIds.length}
          </span>
        ) : (
          <span className="truncate text-foreground" title={primaryTeamName ?? undefined}>
            {primaryTeamName ?? '—'}
          </span>
        )}
      </div>

      {/* Three numeric columns, no bar: Rally draws none on this tab, and it is right not to —
          a Feature has no capacity, so a bar here would imply a ceiling that does not exist. */}
      <div style={colStyleFor('complete', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={item.complete} pct={null} />
      </div>
      <div style={colStyleFor('rollup', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={item.rollup} pct={null} />
      </div>
      <div
        style={colStyleFor('estimated', { flexShrink: 0 })}
        className="flex items-center justify-end gap-1.5 px-2"
      >
        <EstimateTierIcon tier={item.tier} />
        <span className="tabular-nums">{item.estimated}</span>
      </div>

      {/* Rally's per-item menu. `Remove From Plan` drops every team's allocation of the Feature; a
          trash can in a team's sub-table would instead remove it from ONE team while leaving it on
          the plan, which is a different decision and one Rally makes through the assignment
          field. */}
      <div
        style={colStyleFor('actions', { flexShrink: 0 })}
        className="flex items-center justify-center px-1"
      >
        {/* The shared gear, rendered identically in a team's sub-table on the Teams tab. */}
        <CapacityItemActions
          itemKey={item.itemKey}
          hasTeams={item.teamIds.length > 0}
          onAllocate={onAllocate}
          onMove={onMove}
          onUnassign={onUnassign}
          onRemove={onRemove}
        />
      </div>
    </div>
  )
}
