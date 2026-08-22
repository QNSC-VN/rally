/**
 * Backlog column definitions — keys, widths, labels, sort fields and the state filter options.
 *
 * Extracted from `backlog-page.tsx`, which was the largest source file in the app and sat exactly on
 * the `fe-consistency` file-length ratchet, so it could not take another line. Mirrors the shape
 * Iteration Status already uses (`pages/iteration-status/model/columns.ts`): pure data here,
 * composition in the page.
 */
import type { ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import {
  RANK_COLUMN_MIN_WIDTH,
  RANK_COLUMN_WIDTH,
  type DataTableHeaderColumn,
} from '@/shared/ui/table'
import { SCHEDULE_STATE_LABEL, SCHEDULE_STATE_VALUES } from '@/entities/work-item/model/types'

// ── Column definitions ─────────────────────────────────────────────────────────

export type ColumnKey =
  | 'rank'
  | 'id'
  | 'name'
  | 'scheduleState'
  | 'flowState'
  | 'priority'
  | 'estimate'
  | 'owner'
  | 'devOwner'
  | 'release'
  | 'iteration'

export const COLUMN_MINS: Record<ColumnKey, number> = {
  rank: RANK_COLUMN_MIN_WIDTH,
  id: 88,
  name: 180,
  scheduleState: 120,
  flowState: 120,
  priority: 80,
  estimate: 44,
  owner: 90,
  devOwner: 90,
  release: 100,
  iteration: 100,
}

export const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  rank: RANK_COLUMN_WIDTH,
  id: 116,
  name: 260,
  scheduleState: 136,
  flowState: 136,
  priority: 96,
  estimate: 52,
  owner: 120,
  devOwner: 120,
  release: 160,
  iteration: 140,
}

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  rank: 'Rank',
  id: 'ID',
  name: 'Name',
  scheduleState: 'Schedule State',
  flowState: 'Flow State',
  priority: 'Priority',
  estimate: 'Est.',
  owner: 'Owner',
  devOwner: 'Dev Owner',
  release: 'Release',
  iteration: 'Iteration',
}

// Rank leads: the BA lists it first ("Sort icon on Rank, Type, ID, Name, ...") and it is the
// order every other column is read against. It used to live in the leading gutter with a bespoke
// `RankSortHeader`, which is why it could not be resized, reordered or hidden like the rest.
export const COLUMNS: ColumnKey[] = [
  'rank',
  'id',
  'name',
  'scheduleState',
  'flowState',
  'priority',
  'estimate',
  'owner',
  // `P2-BL-FR-012A` (BA 2026-08-22): Dev Owner is an optional column beside Owner, inline
  // editable, sharing Owner's candidate source and persisting independently.
  'devOwner',
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
 * Server-side sort field per column (backend `WorkItemSortBy`), per Phase 2/01 §167.
 *
 * Owner and Dev Owner sort by the joined owner NAME — the same
 * `coalesce(display_name, email)` the cell renders — not by the uuid the row stores. That is why
 * they were absent until the read models joined the name: a uuid order is arbitrary to a reader, so
 * offering the affordance would have been worse than withholding it.
 *
 * Release and Iteration are still absent. `iteration` cannot mean anything here (the Backlog IS the
 * unscheduled rows, so every value is blank); `release` needs a join the backlog query does not
 * carry yet.
 */
export const COLUMN_SORT_FIELD: Partial<Record<ColumnKey, string>> = {
  rank: 'rank',
  id: 'itemKey',
  name: 'title',
  scheduleState: 'scheduleState',
  priority: 'priority',
  estimate: 'planEstimate',
  owner: 'assignee',
  devOwner: 'devOwner',
}

/** Header descriptors for the shared <DataTableHeader>; sortable where mapped. */
export const BACKLOG_HEADER_COLUMNS: DataTableHeaderColumn<ColumnKey>[] = COLUMNS.map((key) => ({
  key,
  label: COLUMN_LABELS[key],
  align: key === 'estimate' ? ('center' as const) : key === 'rank' ? ('right' as const) : undefined,
  sortCol: COLUMN_SORT_FIELD[key],
}))

// ── Resizable column header ────────────────────────────────────────────────────

// ── Owner cell (avatar + name) ─────────────────────────────────────────────────

// ── Main page ─────────────────────────────────────────────────────────────────

export const SCHEDULE_STATE_OPTS = [
  { value: '' as const, label: 'All States' },
  ...SCHEDULE_STATE_VALUES.map((v) => ({ value: v, label: SCHEDULE_STATE_LABEL[v] })),
]
