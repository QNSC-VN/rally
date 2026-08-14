/**
 * WorkItemSummaryPanel — the Backlog's summary panel (WID-FR-003, WID-AC-07).
 *
 * The collapsed half of the Work Item Detail surface: the BA's mockup calls it `DetailPanel`
 * (`03_Mockup Design/src/app/components/shared.tsx`) and the Work Item Detail SRS §35 names that
 * file as the reference for "Summary panel | Collapse behavior". Collapsing the full page returns
 * here with the item STILL SELECTED (AC 7); the panel's own controls are the mockup's two:
 * `Maximize2` back to the full page, and `X` to drop the selection.
 *
 * It resolves the item from `useWorkItemByKey(itemKey)` rather than accepting a `WorkItem` from
 * the grid, because the collapsed item need not be on the Backlog's current page — it is reached
 * by key, exactly as the detail route is. `data === undefined` therefore means "not yet known"
 * and renders a spinner; only a resolved `null` is "no such item".
 *
 * Lives under `pages/backlog/` deliberately: `WID-FR-003` is the only place any SRS specifies a
 * collapse-to-summary, and the Backlog is the surface its field table names. If Quality or
 * Iteration Status ever specify the same panel (the mockup renders `DetailPanel` there too), move
 * this file to `features/work-items/ui/` rather than copying it.
 */
import { useTranslation } from 'react-i18next'
import { Maximize2, X } from 'lucide-react'

import { EMPTY_VALUE, stripHtml } from '@/shared/lib/utils'
import { listResource } from '@/shared/lib/query/resource'
import { IconButton } from '@/shared/ui/icon-button'
import { Spinner } from '@/shared/ui/spinner'
import { DetailField, DetailFieldPair, DetailReadonlyValue } from '@/shared/ui/detail'
import { TypeBadge, ScheduleStateBadge, PriorityBadge } from '@/entities/work-item/ui/badges'
import { useWorkItemByKey } from '@/features/work-items/api'
import { useReleases } from '@/features/releases/api'
import { useIterationOptions } from '@/features/iterations/api'
import { useProjectMembers } from '@/features/teams/api'

interface NamedRef {
  id: string
  name: string
}

/**
 * Label for a reference the item stores as an id.
 *
 * An unset id is genuinely absent → `EMPTY_VALUE`. An id whose lookup list has not arrived yet is
 * NOT absent, and must not render as though it were — that is the same coercion the reports had to
 * stop doing (`?? 0` turning a request in flight into a measured claim).
 */
function refLabel(
  id: string | null | undefined,
  rows: readonly NamedRef[],
  loading: boolean,
  loadingLabel: string,
): string {
  if (!id) return EMPTY_VALUE
  const hit = rows.find((r) => r.id === id)
  if (hit) return hit.name
  // Resolved list, still no match: the referenced row is gone (a project mismatch cannot reach
  // here — the panel unmounts itself below when the item belongs to another project).
  return loading ? loadingLabel : EMPTY_VALUE
}

interface WorkItemSummaryPanelProps {
  /** The selected item's key — the only thing the collapse gesture carries. */
  itemKey: string
  /** The Backlog's active project; the panel hides an item that is not in it. */
  projectId: string
  /** Drop the selection (the mockup's `X`). */
  onClose: () => void
  /** Re-open the full detail page (the mockup's `Maximize2` / `onOpenFull`). */
  onExpand: () => void
}

export function WorkItemSummaryPanel({
  itemKey,
  projectId,
  onClose,
  onExpand,
}: WorkItemSummaryPanelProps) {
  const { t } = useTranslation('work-items')
  const { data: item, isLoading } = useWorkItemByKey(itemKey)

  // Reference lists for the id → name fields. All three are already warm from the Backlog grid,
  // which reads the same keys.
  const { data: releases = [], isLoading: releasesLoading } = useReleases(item?.projectId)
  // The REFERENCE feed (`GET /iterations/options`, every state), not `useIterations`: this panel only
  // resolves an id to a "KEY: name" label, and `GET /iterations` is `timebox:view` — §3.2 hides that
  // surface from an Editor, so on the Backlog it 403'd and every scheduled item read `--`.
  // A resource rather than `?? []`, so a FAILED feed is not the same answer as a resolved list with
  // no match: the first must keep saying "loading/unknown", the second is a genuine EMPTY_VALUE.
  const iterationFeed = listResource(useIterationOptions(item?.projectId))
  const iterations = iterationFeed.rows
  const iterationsLoading = iterationFeed.isLoading || iterationFeed.isError
  const { data: members = [], isLoading: membersLoading } = useProjectMembers(item?.projectId)

  if (isLoading || item === undefined) {
    return (
      <aside
        aria-label={t('summary.label')}
        className="flex w-80 shrink-0 items-center justify-center border-l border-input bg-card"
      >
        <Spinner />
      </aside>
    )
  }

  // A key that resolves to nothing, or to another project's item, has nothing to summarise on
  // THIS Backlog. Render nothing rather than an empty frame.
  if (item === null || item.projectId !== projectId) return null

  // Composite "KEY: name" labels, the same form the Backlog grid's own Release/Iteration cells
  // use — the panel sits directly beside those cells, so one value must not read two ways.
  const releaseRefs = releases.map((r) => ({
    id: r.id,
    name: r.releaseKey ? `${r.releaseKey}: ${r.name}` : r.name,
  }))
  const iterationRefs = iterations.map((i) => ({
    id: i.id,
    name: i.iterationKey ? `${i.iterationKey}: ${i.name}` : i.name,
  }))

  const owner = members.find((m) => m.userId === item.assigneeId)
  const ownerName = item.assigneeId
    ? (owner?.displayName ?? owner?.email ?? (membersLoading ? t('sidebar.loading') : EMPTY_VALUE))
    : t('common:unassigned')
  const description = stripHtml(item.description)

  return (
    <aside
      aria-label={t('summary.label')}
      className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-input bg-card"
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-avatar px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <TypeBadge type={item.type} size={16} />
            <span className="font-mono text-ui-sm text-muted-foreground">{item.itemKey}</span>
          </div>
          <p className="text-ui-lg leading-snug font-semibold text-foreground">{item.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label={t('summary.expand')}
            title={t('summary.expand')}
            onClick={onExpand}
          >
            <Maximize2 size={14} />
          </IconButton>
          <IconButton aria-label={t('summary.close')} title={t('summary.close')} onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <DetailFieldPair>
          <DetailField label={t('sidebar.scheduleState')}>
            <ScheduleStateBadge state={item.scheduleState} />
          </DetailField>
          <DetailField label={t('sidebar.priority')}>
            {item.type === 'defect' ? (
              <PriorityBadge priority={item.priority} />
            ) : (
              <span className="font-mono text-ui-xs text-foreground-disabled">{EMPTY_VALUE}</span>
            )}
          </DetailField>
        </DetailFieldPair>

        <DetailField label={t('common:owner')}>
          <DetailReadonlyValue>{ownerName}</DetailReadonlyValue>
        </DetailField>

        <DetailFieldPair>
          <DetailField label={t('sidebar.planEstimatePts')}>
            <DetailReadonlyValue mono>{item.storyPoints ?? EMPTY_VALUE}</DetailReadonlyValue>
          </DetailField>
          <DetailField label={t('sidebar.release')}>
            <DetailReadonlyValue>
              {refLabel(item.releaseId, releaseRefs, releasesLoading, t('sidebar.loading'))}
            </DetailReadonlyValue>
          </DetailField>
        </DetailFieldPair>

        <DetailField label={t('sidebar.iteration')}>
          <DetailReadonlyValue>
            {refLabel(item.iterationId, iterationRefs, iterationsLoading, t('sidebar.loading'))}
          </DetailReadonlyValue>
        </DetailField>

        <DetailField label={t('common:description')}>
          <p className="text-ui-md leading-relaxed text-foreground-subtle">
            {description || EMPTY_VALUE}
          </p>
        </DetailField>
      </div>
    </aside>
  )
}
