import { useCallback, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { useDataTable } from '@/shared/ui/table'
import { EmptyState } from '@/shared/ui/empty-state'
import type { CapacityAllocation } from '@/features/capacity-planning/api'
import { CAPACITY_ALLOCATION_COLUMNS, type AllocColKey } from '../model/columns'
import { AllocationRow } from './allocation-row'

/**
 * The nested table of Features allocated to one team — Rally's sub-table under an expanded row.
 *
 * A real table, not a run of rows borrowing the parent's columns: Rally renders it with its own
 * header, and it has to, because the columns mean different things one level down. The parent's
 * `Features` is a count and its `Capacity` is the ceiling a planner typed; a child row has neither
 * — it has an `Allocation`, the slice of that ceiling this Feature was promised. Continuing the
 * parent's headers put a child's allocation under a header reading "Capacity".
 *
 * Built from the same `useDataTable` + `DataTableFrame` as every grid in the app, so it resizes,
 * reorders and lays out identically to the table it sits inside. Every instance shares one storage
 * key on purpose: these are all the same table, so widening `Name` under one team widens it under
 * the next.
 */
export function TeamAllocationsTable({
  planId,
  allocations,
  teamName,
  unitLabel,
  canManage,
  onOpenFeature,
  rankPositionOf,
  planProjectId,
}: {
  planId: string
  allocations: CapacityAllocation[]
  /** Owning team, or null for the Unallocated bucket. Used for the make-primary label. */
  teamName: string | null
  unitLabel: string
  canManage: boolean
  onOpenFeature: (portfolioItemId: string) => void
  /**
   * The Feature's 1-based position in the PLAN's rank order.
   *
   * Resolved by the page from the plan's item list rather than counted inside this table: a team's
   * rows are a subset of the plan, so counting locally would number them 1..n and claim a priority
   * order this team does not own.
   */
  rankPositionOf: (portfolioItemId: string) => number | null
  /** The plan's project — a Feature from another one is marked `← from` in the Allocation column. */
  planProjectId: string
}) {
  const { t } = useTranslation('capacity')
  const table = useDataTable<CapacityAllocation, unknown, AllocColKey>(
    CAPACITY_ALLOCATION_COLUMNS,
    { storageKey: 'rally-capacity-allocation-columns' },
  )
  const colStyleFor = useCallback(
    (key: AllocColKey, base?: CSSProperties) => table.styleFor(key, base),
    [table],
  )

  return (
    // Indented and rule-bounded so the nesting is visible without a connector line: the left
    // border reads as "everything to the right of this belongs to the row above".
    <div className="border-b border-border-inner bg-surface-subtle/40 py-1 pl-8">
      <div className="border-l-2 border-border-subtle pl-2">
        <DataTableFrame
          header={table.headerProps}
          padClassName="px-2"
          empty={
            allocations.length === 0 ? <EmptyState title={t('row.noAllocations')} /> : undefined
          }
        >
          {allocations.map((allocation) => (
            <AllocationRow
              key={allocation.id}
              planId={planId}
              allocation={allocation}
              unitLabel={unitLabel}
              canManage={canManage}
              colStyleFor={colStyleFor}
              onOpenFeature={onOpenFeature}
              teamName={teamName}
              rankPosition={rankPositionOf(allocation.portfolioItemId)}
              planProjectId={planProjectId}
            />
          ))}
        </DataTableFrame>
      </div>
    </div>
  )
}
