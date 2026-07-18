/**
 * BulkScheduleBar — the shared "assign Release / assign Iteration to the
 * selected work items" strip.
 *
 * Backlog and Quality (and any future table over work items) drove the exact
 * same two InlineSelect controls plus the identical bulk-assign handlers +
 * error state inline. This hoists that pattern to a single source of truth on
 * top of the generic {@link BulkActionBar}: it owns the mutations, the inline
 * error, and the "N selected" chrome. Renders nothing when no rows are
 * selected, so callers can drop it straight into their layout.
 */
import { useState } from 'react'
import { BulkActionBar } from '@/shared/ui/bulk-action-bar'
import { InlineSelect } from '@/shared/ui/native-select'
import { useBulkAssignRelease, useBulkAssignIteration } from '@/features/work-items/api'

interface ScheduleOption {
  id: string
  name: string
}

interface BulkScheduleBarProps {
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

export function BulkScheduleBar({
  projectId,
  selectedIds,
  clearSelection,
  releases,
  iterations,
  canEdit,
  onAssigned,
}: BulkScheduleBarProps) {
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

  if (selectedIds.size === 0) return null

  return (
    <BulkActionBar
      selectedCount={selectedIds.size}
      error={bulkError}
      onClear={() => {
        clearSelection()
        setBulkError(null)
      }}
    >
      {canEdit && (
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
        </>
      )}
    </BulkActionBar>
  )
}
