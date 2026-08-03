/**
 * Backlog column definitions — keys, widths, labels, sort fields and the state filter options.
 *
 * Extracted from `backlog-page.tsx`, which was the largest source file in the app and sat exactly on
 * the `fe-consistency` file-length ratchet, so it could not take another line. Mirrors the shape
 * Iteration Status already uses (`pages/iteration-status/model/columns.ts`): pure data here,
 * composition in the page.
 */
import type { ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import type { DataTableHeaderColumn } from '@/shared/ui/table'
import { SCHEDULE_STATE_LABEL, SCHEDULE_STATE_VALUES } from '@/entities/work-item/model/types'

// ── Column definitions ─────────────────────────────────────────────────────────

export type ColumnKey =
  | 'id'
  | 'name'
  | 'scheduleState'
  | 'flowState'
  | 'priority'
  | 'estimate'
  | 'owner'
  | 'release'
  | 'iteration'

export const COLUMN_MINS: Record<ColumnKey, number> = {
  id: 88,
  name: 180,
  scheduleState: 120,
  flowState: 120,
  priority: 80,
  estimate: 44,
  owner: 90,
  release: 100,
  iteration: 100,
}

export const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  id: 116,
  name: 260,
  scheduleState: 136,
  flowState: 136,
  priority: 96,
  estimate: 52,
  owner: 120,
  release: 160,
  iteration: 140,
}

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  id: 'ID',
  name: 'Name',
  scheduleState: 'Schedule State',
  flowState: 'Flow State',
  priority: 'Priority',
  estimate: 'Est.',
  owner: 'Owner',
  release: 'Release',
  iteration: 'Iteration',
}

export const COLUMNS: ColumnKey[] = [
  'id',
  'name',
  'scheduleState',
  'flowState',
  'priority',
  'estimate',
  'owner',
  'release',
  'iteration',
]

export const BACKLOG_COLUMNS: ColumnDef<ColumnKey>[] = COLUMNS.map((key) => ({
  key,
  label: COLUMN_LABELS[key],
  defaultWidth: DEFAULT_WIDTHS[key],
  minWidth: COLUMN_MINS[key],
}))

/**
 * Server-side sort field per column (backend `WorkItemSortBy`). Columns absent
 * from this map are not sortable (owner/release/iteration would sort by UUID).
 */
export const COLUMN_SORT_FIELD: Partial<Record<ColumnKey, string>> = {
  id: 'itemKey',
  name: 'title',
  scheduleState: 'scheduleState',
  priority: 'priority',
  estimate: 'planEstimate',
}

/** Header descriptors for the shared <DataTableHeader>; sortable where mapped. */
export const BACKLOG_HEADER_COLUMNS: DataTableHeaderColumn<ColumnKey>[] = COLUMNS.map((key) => ({
  key,
  label: COLUMN_LABELS[key],
  align: key === 'estimate' ? ('center' as const) : undefined,
  sortCol: COLUMN_SORT_FIELD[key],
}))

// ── Resizable column header ────────────────────────────────────────────────────

// ── Owner cell (avatar + name) ─────────────────────────────────────────────────

// ── Main page ─────────────────────────────────────────────────────────────────

export const SCHEDULE_STATE_OPTS = [
  { value: '' as const, label: 'All States' },
  ...SCHEDULE_STATE_VALUES.map((v) => ({ value: v, label: SCHEDULE_STATE_LABEL[v] })),
]
