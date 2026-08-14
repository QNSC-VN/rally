/**
 * Backlog Manage Filters field list — `P2-BL-FR-004` / `-005` / `-006`, AC-8/9.
 *
 * Each key IS the server query parameter, so the page can hand `applied`
 * straight to `useBacklog` with no translation layer in between to drift.
 *
 * `kind` follows FR-006 exactly: "Filter ID, Name và Est dùng text/number input;
 * các field còn lại dùng dropdown."
 *
 * Labels come from `COLUMN_LABELS`, the same map the grid header and the Show
 * Fields menu read, so a filter can never be labelled differently from the
 * column it filters. Only `Type` needs its own string — the Backlog grid has no
 * Type column (the type is a glyph inside the ID cell).
 *
 * The SRS's Iteration filter (FR-004, §5) is NOT offered here, and cannot be:
 * `listBacklog` is unconditionally `iteration_id IS NULL` (the rule that defines
 * the screen — `RECONCILED_SOURCE_OF_TRUTH.md:42`, and Rally's "once the item is
 * scheduled into a release or iteration, it is removed from the Backlog page").
 * Every row's Iteration is therefore `Unscheduled`, so an Iteration dropdown
 * could only ever return everything or nothing. Iteration filtering belongs on
 * Iteration Status, which is the screen the assignment moves the item to.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  UNASSIGNED_OWNER,
  type FilterFieldDef,
  type FilterValues,
} from '@/features/work-items/model/manage-filters'
import type { BacklogFilters } from '@/features/work-items/api'
import {
  PRIORITY_LABEL,
  PRIORITY_VALUES,
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
} from '@/entities/work-item/model/types'
import { COLUMN_LABELS } from './columns'

/** Server query parameter names — see `WorkItemQuerySchema`. */
export type BacklogFilterKey =
  | 'itemKey'
  | 'title'
  | 'type'
  | 'scheduleState'
  | 'priority'
  | 'planEstimate'
  | 'assigneeId'
  | 'releaseId'

/**
 * Applied Manage Filters values, as the backlog list query's own filter shape.
 *
 * A control's value is text, so `FilterValues` is `string` by construction —
 * while `BacklogFilters.type` / `.scheduleState` / `.priority` are unions. The
 * option lists above are built FROM those unions, so the narrowing is sound; it
 * happens once here rather than at each call site, and the `Pick` keeps the two
 * key sets provably identical (a field key that is not a query parameter stops
 * compiling).
 */
export function toBacklogQuery(
  applied: FilterValues<BacklogFilterKey>,
): Pick<BacklogFilters, BacklogFilterKey> {
  return applied as Pick<BacklogFilters, BacklogFilterKey>
}

export interface BacklogFilterSources {
  members: Array<{ userId: string; displayName?: string; email?: string }>
  releases: Array<{ id: string; name: string; releaseKey?: string | null }>
}

export function useBacklogFilterFields({
  members,
  releases,
}: BacklogFilterSources): FilterFieldDef<BacklogFilterKey>[] {
  const { t } = useTranslation('backlog')

  return useMemo(
    () => [
      // `defaultVisible` marks the five filters this screen already shipped, so
      // adding Manage Filters cannot take a working control away from anyone.
      { key: 'itemKey', label: COLUMN_LABELS.id, kind: 'text' },
      { key: 'title', label: COLUMN_LABELS.name, kind: 'text' },
      {
        key: 'type',
        label: t('filters.type'),
        kind: 'select',
        defaultVisible: true,
        options: [
          { value: 'story', label: t('typeStory') },
          { value: 'defect', label: t('typeDefect') },
        ],
      },
      {
        key: 'scheduleState',
        label: COLUMN_LABELS.scheduleState,
        kind: 'select',
        defaultVisible: true,
        options: SCHEDULE_STATE_VALUES.map((s) => ({ value: s, label: SCHEDULE_STATE_LABEL[s] })),
      },
      {
        key: 'priority',
        label: COLUMN_LABELS.priority,
        kind: 'select',
        defaultVisible: true,
        options: PRIORITY_VALUES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
      },
      { key: 'planEstimate', label: COLUMN_LABELS.estimate, kind: 'number' },
      {
        key: 'assigneeId',
        label: COLUMN_LABELS.owner,
        kind: 'select',
        defaultVisible: true,
        options: [
          { value: UNASSIGNED_OWNER, label: t('filters.unassigned') },
          ...members.map((m) => ({
            value: m.userId,
            label: m.displayName ?? m.email ?? m.userId,
          })),
        ],
      },
      {
        key: 'releaseId',
        label: COLUMN_LABELS.release,
        kind: 'select',
        defaultVisible: true,
        options: releases.map((r) => ({
          value: r.id,
          label: r.releaseKey ? `${r.releaseKey}: ${r.name}` : r.name,
        })),
      },
    ],
    [t, members, releases],
  )
}
