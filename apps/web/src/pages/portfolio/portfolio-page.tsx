/**
 * Portfolio — the Epic / Feature list (BA spec §3.1–3.2).
 *
 * Rewritten for P5. The previous version assembled an Initiative → Feature → Story
 * tree on the client from work items of type `initiative`/`feature`; those types no
 * longer exist (migration 0072) and the hierarchy now lives in
 * `work.portfolio_items` with rollups computed server-side.
 *
 * Uses `ListPageScaffold` like every other list surface rather than the bespoke
 * flex-width grid it used to hand-roll, so column resize / reorder / show-hide,
 * selection and pagination behave identically to Releases and Iterations.
 *
 * This list is deliberately CROSS-PROJECT: a Workspace Admin sees every project's
 * portfolio, which is why there is no "select a project" gate and why Project is a
 * column. The API narrows rows to the caller's readable projects.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Archive, PackageOpen, Plus } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { notify } from '@/shared/lib/toast'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions, useProjectPermissionsFor } from '@/features/access/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { type RowSelection } from '@/shared/lib/hooks/use-row-selection'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { EmptyState } from '@/shared/ui/empty-state'
import { InlineSelect } from '@/shared/ui/native-select'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { useDataTable, useRowRerank } from '@/shared/ui/table'
import { ListPageScaffold } from '@/shared/ui/list-page/list-page-scaffold'
import { ListPageHeader } from '@/shared/ui/list-page/list-page-header'
import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import {
  usePortfolioItems,
  useRankPortfolioItem,
  useSetPortfolioItemArchived,
  type PortfolioItem,
} from '@/features/portfolio/api'
import { PORTFOLIO_COLUMNS, type ColKey } from './model/columns'
import { PORTFOLIO_STATES } from './model/portfolio-states'
import { PortfolioRow } from './ui/portfolio-row'
import { PortfolioTypeSwitcher } from './ui/portfolio-type-switcher'
import { CreatePortfolioItemModal } from './ui/create-portfolio-item-modal'

export function PortfolioPage() {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()

  const [type, setType] = useState<PortfolioItemType>(PortfolioItemType.Feature)
  const [stateFilter, setStateFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  /**
   * The item to bring into view — set after a create.
   *
   * Never cleared here: the scaffold decides when the highlight stops applying (the user pages
   * away), and keeping the id means the row is still found if the list refetches a moment
   * later — which it usually does, right after the create.
   */
  const [revealId, setRevealId] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  // Creating targets ONE project, so it uses the currently-selected project the way every
  // other list page does. Editing is per-row (see `rowPerms`) because the grid is
  // cross-project and each row may sit in a different one.
  const { project, workspace } = useAppContext()
  const createProjectId = project?.projectId
  const { can: canInProject } = useProjectPermissions(createProjectId)
  const canCreate = !!createProjectId && canInProject('portfolio:create')
  const setArchived = useSetPortfolioItemArchived()

  /**
   * Roster for the inline Owner picker. Fetched ONCE here and handed to every row —
   * per-row would be one request per visible row for a list that is already cached
   * workspace-wide (`workspace-members-profile`). Workspace-scoped, not project-scoped:
   * this grid is cross-project, so a single roster covers every row.
   */
  const { data: members = [] } = useWorkspaceMembers(workspace?.workspaceId)

  const table = useDataTable<PortfolioItem, unknown, ColKey>(PORTFOLIO_COLUMNS, {
    storageKey: STORAGE_KEYS.PORTFOLIO_COLUMNS,
    leadingWidth: 36,
  })
  const colStyleFor = useCallback(
    (key: ColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
  )

  // Type is a SERVER filter — the API has no combined Epic+Feature view, matching
  // the spec's exclusive Type selector.
  const { items, total, isLoading, isError } = usePortfolioItems({ type })

  // One permission lookup per DISTINCT project on the page, deduped and cache-shared with
  // the single-project hook.
  const projectIds = useMemo(() => items.map((i) => i.projectId), [items])
  const rowPerms = useProjectPermissionsFor(projectIds)

  const openDetail = useCallback(
    (id: string) => void navigate({ to: '/portfolio/$itemId', params: { itemId: id } }),
    [navigate],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(
      (i) =>
        (stateFilter === 'all' || i.state === stateFilter) &&
        (!q || i.name.toLowerCase().includes(q) || i.itemKey.toLowerCase().includes(q)),
    )
  }, [items, search, stateFilter])

  const { sortField, sortDir, toggle } = useTableSort<ColKey>()
  const sorted = useMemo(() => {
    if (!sortField) return filtered
    const dir = sortDir === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, string | number | null>)[sortField] ?? ''
      const bv = (b as unknown as Record<string, string | number | null>)[sortField] ?? ''
      if (av < bv) return -dir
      if (av > bv) return dir
      return 0
    })
  }, [filtered, sortField, sortDir])

  /**
   * Drag-to-rank.
   *
   * Disabled unless the grid is in NATURAL rank order (`sortField === null`). Rank only
   * means anything in that order; dragging inside a Name-sorted view would hand the API
   * neighbours whose ranks bear no relation to what the user sees, and the derived rank
   * would drop the row somewhere else entirely.
   *
   * Also disabled without edit rights. That is per-row on this cross-project grid, so the
   * grip is gated per row too — this flag only turns the whole mechanism off.
   */
  const rank = useRankPortfolioItem()
  const rerank = useRowRerank({
    items: sorted,
    disabled: sortField !== null,
    onReorder: ({ id, beforeId, afterId }) =>
      rank.mutate({ id, beforeId, afterId }, { onError: (err) => notify.error(err.message) }),
  })

  // Accepted/done counts come from the loaded rows; `total` is the server's count for
  // the whole filter set, so it stays correct while later pages are still arriving.
  const stats = useMemo(
    () => ({
      inFlight: items.filter((i) => i.state === 'developing').length,
      done: items.filter((i) => i.state === 'done').length,
    }),
    [items],
  )

  /**
   * Archive every selected row the caller may archive.
   *
   * Rows in projects they cannot archive are SKIPPED rather than attempted, so a mixed
   * selection on this cross-project grid does not half-fail with a wall of 403s. An Epic
   * that still has active Features is refused by the API; that message surfaces per item.
   */
  async function archiveSelected(selection: RowSelection) {
    const targets = rerank.items.filter(
      (i) => selection.selectedIds.has(i.id) && rowPerms.can(i.projectId, 'portfolio:archive'),
    )
    const results = await Promise.allSettled(
      targets.map((i) => setArchived.mutateAsync({ id: i.id, archived: true })),
    )
    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      const first = failed[0]
      notify.error(
        first.status === 'rejected' && first.reason instanceof Error
          ? first.reason.message
          : t('archive.failed'),
      )
    } else {
      notify.success(t('archive.archived', { count: targets.length }))
      selection.clear()
    }
    setConfirmArchive(false)
  }

  return (
    <>
      <ListPageScaffold<PortfolioItem, ColKey>
        header={
          <ListPageHeader
            title={t('title')}
            accessory={<PortfolioTypeSwitcher value={type} onChange={setType} />}
          />
        }
        metrics={
          <MetricStrip>
            <MetricCard label={t('metrics.total')} value={total ?? items.length} minWidth={100} />
            <MetricCard label={t('metrics.developing')} value={stats.inFlight} minWidth={100} />
            <MetricCard label={t('metrics.done')} value={stats.done} minWidth={90} />
          </MetricStrip>
        }
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('searchPlaceholder'),
          ariaLabel: t('searchPlaceholder'),
          width: 200,
        }}
        activeFilterCount={stateFilter !== 'all' ? 1 : 0}
        filters={
          <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
            {t('filters.state')}
            <InlineSelect
              value={stateFilter}
              aria-label={t('filters.state')}
              onChange={(e) => setStateFilter(e.target.value)}
              className="w-auto"
            >
              <option value="all">{t('filters.allStates')}</option>
              {PORTFOLIO_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`states.${s}`, { defaultValue: s })}
                </option>
              ))}
            </InlineSelect>
          </label>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={13} /> {t('common:addNew')}
            </Button>
          ) : undefined
        }
        bulkActions={(selection) => (
          <>
            <button
              type="button"
              onClick={() => setConfirmArchive(true)}
              disabled={setArchived.isPending}
              className="flex items-center gap-1 rounded px-2 py-1 text-ui-sm font-medium text-destructive transition-colors hover:bg-card disabled:opacity-50"
            >
              <Archive size={12} />
              {t('archive.action')}
            </button>
            <ConfirmDialog
              open={confirmArchive}
              title={t('archive.title')}
              message={t('archive.message', { count: selection.count })}
              confirmLabel={t('archive.confirm')}
              destructive
              pending={setArchived.isPending}
              onConfirm={() => void archiveSelected(selection)}
              onCancel={() => setConfirmArchive(false)}
            />
          </>
        )}
        headerProps={table.headerProps}
        headerColumns={table.headerColumns}
        colStyles={table.colStyles}
        sort={{ col: sortField ?? '', dir: sortDir ?? 'asc', onSort: (c) => toggle(c as ColKey) }}
        items={rerank.items}
        dnd={{
          dndContextProps: rerank.dndContextProps,
          sortableContextProps: rerank.sortableContextProps,
        }}
        loading={isLoading}
        skeleton={{ rows: 8, cols: 8 }}
        error={
          isError ? (
            <EmptyState
              icon={<AlertTriangle size={28} className="text-destructive" />}
              title={t('loadError')}
            />
          ) : undefined
        }
        empty={
          sorted.length === 0 ? (
            <EmptyState
              icon={<PackageOpen size={32} className="text-border-strong" />}
              title={search ? t('emptySearch') : t('empty')}
            />
          ) : undefined
        }
        revealRowId={revealId}
        renderRow={(item, { gutterProps, revealed }) => (
          <PortfolioRow
            key={item.id}
            item={item}
            revealed={revealed}
            canEdit={rowPerms.can(item.projectId, 'portfolio:edit')}
            canRank={sortField === null && rowPerms.can(item.projectId, 'portfolio:edit')}
            members={members}
            colStyleFor={colStyleFor}
            gutterProps={gutterProps}
            onOpen={openDetail}
          />
        )}
      />

      {showCreate && createProjectId && (
        <CreatePortfolioItemModal
          projectId={createProjectId}
          type={type}
          onClose={() => setShowCreate(false)}
          onCreated={setRevealId}
        />
      )}
    </>
  )
}
