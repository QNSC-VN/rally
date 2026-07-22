/**
 * Bulk "assign Release / assign Iteration to the selected work items" controls.
 *
 * `BulkScheduleActions` renders just the two InlineSelect controls + inline
 * error (owns the mutations), designed to drop into a shared `BulkActionBar`
 * via SelectableTable's `bulkActions` slot. `BulkScheduleBar` is the legacy
 * standalone wrapper (its own bar) kept for any caller not yet on SelectableTable.
 */
import { useState } from 'react'
import { BulkActionBar } from '@/shared/ui/bulk-action-bar'
import { InlineSelect } from '@/shared/ui/native-select'
import { useBulkAssignRelease, useBulkAssignIteration } from '@/features/work-items/api'

interface ScheduleOption {
  id: string
  name: string
}

interface BulkScheduleActionsProps {
  projectId: string | undefined
  selectedIds: Set<string>
  clearSelection: () => void
  releases: ScheduleOption[]
  iterations: ScheduleOption[]
  /** Gate the controls behind the caller's edit/manage permission. */
  canEdit: boolean
  /** Optional hook run after a successful bulk assign (e.g. cache invalidation). */
  onAssigned?: () => void | Promise<void>
}

/** The Release/Iteration assign controls (no bar) — render inside a BulkActionBar. */
export function BulkScheduleActions({
  projectId,
  selectedIds,
  clearSelection,
  releases,
  iterations,
  canEdit,
  onAssigned,
}: BulkScheduleActionsProps) {
  const bulkRelease = useBulkAssignRelease()
  const bulkIteration = useBulkAssignIteration()
  const [bulkError, setBulkError] = useState<string | null>(null)

  async function assignReleaseToSelected(releaseId: string | null) {
    if (!projectId || selectedIds.size === 0) return
    setBulkError(null)
    try {
      await bulkRelease.mutateAsync({ projectId, itemIds: [...selectedIds], releaseId })
      await onAssigned?.()
      clearSelection()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Bulk release assignment failed')
    }
  }

  async function assignIterationToSelected(iterationId: string | null) {
    if (!projectId || selectedIds.size === 0) return
    setBulkError(null)
    try {
      await bulkIteration.mutateAsync({ projectId, itemIds: [...selectedIds], iterationId })
      await onAssigned?.()
      clearSelection()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Bulk iteration assignment failed')
    }
  }

  if (!canEdit) return null

  return (
    <>
      <InlineSelect
        value=""
        disabled={bulkRelease.isPending}
        onChange={(e) => {
          if (!e.target.value) return
          void assignReleaseToSelected(e.target.value === '__none__' ? null : e.target.value)
        }}
        className="w-auto"
        aria-label="Assign release to selected"
      >
        <option value="">Assign Release…</option>
        <option value="__none__">— Unschedule —</option>
        {releases.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </InlineSelect>

      <InlineSelect
        value=""
        disabled={bulkIteration.isPending}
        onChange={(e) => {
          if (!e.target.value) return
          void assignIterationToSelected(e.target.value === '__none__' ? null : e.target.value)
        }}
        className="w-auto"
        aria-label="Assign iteration to selected"
      >
        <option value="">Assign Iteration…</option>
        <option value="__none__">— Unschedule —</option>
        {iterations.map((it) => (
          <option key={it.id} value={it.id}>
            {it.name}
          </option>
        ))}
      </InlineSelect>

      {bulkError && <span className="text-ui-sm text-destructive">{bulkError}</span>}
    </>
  )
}

/** Legacy standalone bar (owns its own BulkActionBar). Prefer SelectableTable +
 *  `bulkActions={() => <BulkScheduleActions … />}`. */
export function BulkScheduleBar(props: BulkScheduleActionsProps) {
  if (props.selectedIds.size === 0) return null
  return (
    <BulkActionBar selectedCount={props.selectedIds.size} onClear={props.clearSelection}>
      <BulkScheduleActions {...props} />
    </BulkActionBar>
  )
}
