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
import { AlertTriangle, Archive, PackageOpen, Pencil, Plus } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { notify } from '@/shared/lib/toast'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions, useProjectPermissionsFor } from '@/features/access/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { useProjects } from '@/features/projects/api'
import { type RowSelection } from '@/shared/lib/hooks/use-row-selection'
import { EmptyState } from '@/shared/ui/empty-state'
import { InlineSelect } from '@/shared/ui/native-select'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { useDataTable } from '@/shared/ui/table'
import { ListPageScaffold } from '@/shared/ui/list-page/list-page-scaffold'
import { BulkActionButton } from '@/shared/ui/bulk-action-bar'
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
import { PORTFOLIO_COLUMNS, portfolioSortValue, type ColKey } from './model/columns'
import { usePortfolioCellOptions } from './model/use-cell-options'
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
  /**
   * Which type the create dialog is opening for, or null when it is closed.
   *
   * Still a type rather than a boolean, but it is now always set from `type` — the Type
   * switcher above the grid IS the choice, so Add New creates the level being viewed. It
   * previously came from a `New Epic` / `New Feature` dropdown (SRS §4, §11.2), which asked
   * for the same decision a second time and could contradict the switcher.
   */
  const [createType, setCreateType] = useState<PortfolioItemType | null>(null)
  /**
   * The item to bring into view — set after a create.
   *
   * Never cleared here: the scaffold decides when the highlight stops applying (the user pages
   * away), and keeping the id means the row is still found if the list refetches a moment
   * later — which it usually does, right after the create.
   */
  const [revealId, setRevealId] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  /**
   * Opt OUT of the selected-project scope, showing every project the caller can read.
   *
   * The page used to be unconditionally cross-project, which meant the global project
   * selector said "NX Platform" while the grid listed items from every other project —
   * every other list surface (Releases, Milestones, Iterations) narrows to
   * `project.projectId`, so this one read as a bug even though it was intentional.
   *
   * Kept as an explicit opt-out rather than deleted, because the cross-project view is
   * genuinely useful to a Workspace Admin comparing portfolios — which is also why
   * Project remains a column.
   */
  const [allProjects, setAllProjects] = useState(false)

  // Creating targets ONE project, so it uses the currently-selected project the way every
  // other list page does. Editing is per-row (see `rowPerms`) because the grid can be
  // cross-project and each row may then sit in a different one.
  const { project, team, workspace } = useAppContext()
  const createProjectId = project?.projectId
  /**
   * The project the list is narrowed to, or `undefined` for every readable project.
   *
   * Derived from the selector rather than copied into state, so switching projects in the
   * header re-scopes the grid immediately. With no project selected there is nothing to
   * narrow to, so it falls back to showing everything instead of an empty grid.
   */
  const scopedProjectId = allProjects ? undefined : createProjectId
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

  // Type and project are SERVER filters — the API has no combined Epic+Feature view
  // (matching the spec's exclusive Type selector), and narrowing the project server-side
  // keeps the grid describing the scope the user is actually looking at.
  //
  // `total` is deliberately unused: the BA removed the summary metrics strip that read it
  // ("no need", SRS:28), and the list goes from the breadcrumb straight to the toolbar.
  /**
   * The global TEAM context narrows the list, and an Epic + specific Team shows nothing.
   *
   * An Epic is project-level and has no team (`ck_portfolio_epic_shape`), so a team filter can
   * only ever match Features. The BA asks for an explicit message rather than an empty grid —
   * "specific Team + Epic shows `Filter not show item`" (SRS:52, FR-035, Q16) — and the service
   * already returns an empty page for that pair, deliberately, so the UI can say why. The page
   * simply never passed the team, so the whole rule was unreachable: an Epic list under a selected
   * Team showed every Epic in the project.
   */
  const teamId = team?.teamId ?? undefined
  const { items, isLoading, isError } = usePortfolioItems({
    type,
    projectId: scopedProjectId,
    teamId,
  })
  const filterHidesEpics = teamId !== undefined && type === PortfolioItemType.Epic

  // One permission lookup per DISTINCT project on the page, deduped and cache-shared with
  // the single-project hook.
  const projectIds = useMemo(() => items.map((i) => i.projectId), [items])
  const rowPerms = useProjectPermissionsFor(projectIds)
  /**
   * Edit rights by project, for the rows a disclosure reveals.
   *
   * A child Feature may live in a project that has no top-level row on this page, so its
   * id was never in `projectIds` and no per-project lookup was fetched for it. `can` then
   * falls back to the workspace baseline, which is safe because the model is purely
   * additive — and the API is the real gate either way.
   */
  const canEditProject = useCallback(
    (projectId: string) => rowPerms.can(projectId, 'portfolio:edit'),
    [rowPerms],
  )

  // Epic / Release / Team pickers, scoped to each row's own project — see the hook.
  const optionsFor = usePortfolioCellOptions(workspace?.workspaceId, projectIds)

  /**
   * Move destinations for the Project cell — workspace-wide, not the loaded rows' projects.
   *
   * A move targets a project the grid may not be showing (that is the point of a move), so
   * this deliberately does not reuse `projectIds`. Archived projects are dropped: they
   * cannot take new work.
   */
  const { data: allProjectRows = [] } = useProjects(workspace?.workspaceId)
  const projectOptions = useMemo(
    () =>
      allProjectRows
        .filter((p) => p.status !== 'archived')
        .map((p) => ({ id: p.id, key: p.key, name: p.name })),
    [allProjectRows],
  )

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
      // `portfolioSortValue`, not `item[sortField]`: the old lookup sorted Project by its uuidv7 and
      // could not reach a nested or derived field at all — see the note on that function.
      const av = portfolioSortValue(a, sortField)
      const bv = portfolioSortValue(b, sortField)
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

  /**
   * The BA's `Move up` / `Move down` (§37, FR-005), one position at a time.
   *
   * This grid used to DRAG, which §14 lists under Not included — and a drag has no keyboard until the
   * shared grip is given a sensor, where two buttons have one for free. Same endpoint either way: the
   * portfolio rank is one order, and the Backlog reads it too.
   *
   * `beforeId`/`afterId` are the rows the item lands BETWEEN, so a move up targets the pair one
   * position higher. `undefined` at the ends of the list, and while a column sort is active: a running
   * order means nothing under any other sort, which is also why §273 asks for the order to survive
   * returning to the Rank column.
   */
  const moveHandlers = useCallback(
    (id: string): { onMoveUp?: () => void; onMoveDown?: () => void } => {
      if (sortField !== null) return {}
      const at = sorted.findIndex((i) => i.id === id)
      if (at === -1) return {}
      const run = (beforeId: string | null, afterId: string | null) => () =>
        rank.mutate({ id, beforeId, afterId }, { onError: (err) => notify.error(err.message) })
      return {
        ...(at > 0 ? { onMoveUp: run(at >= 2 ? sorted[at - 2].id : null, sorted[at - 1].id) } : {}),
        ...(at < sorted.length - 1
          ? {
              onMoveDown: run(sorted[at + 1].id, at + 2 < sorted.length ? sorted[at + 2].id : null),
            }
          : {}),
      }
    },
    [rank, sortField, sorted],
  )

  /**
   * Archive every selected row that CAN be archived, and report every one that could not.
   *
   * The BA's rule is a partial success, not all-or-nothing: "`Delete` archives the selected
   * Portfolio Items rather than hard-deleting them; an Epic with active child Features is skipped
   * and reported" (SRS:54, FR-037). Two ways a row is skipped, and both used to vanish:
   *
   *   • no `portfolio:archive` on that row's project — a real case on this cross-project grid, and
   *     silently dropping it meant "6 items archived" for a selection of eight;
   *   • the API refuses it, which is how an Epic with active children presents.
   *
   * Only `failed[0].reason.message` was surfaced, so a mixed failure reported one row and hid the
   * rest, and the successes were reported as if nothing had gone wrong. Now: the successes are
   * counted, the skips are NAMED by item key, and the selection keeps the rows that did not go
   * through so the planner can act on exactly those.
   */
  async function archiveSelected(selection: RowSelection) {
    const selected = sorted.filter((i) => selection.selectedIds.has(i.id))
    const [allowed, forbidden] = selected.reduce<[PortfolioItem[], PortfolioItem[]]>(
      ([ok, no], item) =>
        rowPerms.can(item.projectId, 'portfolio:archive')
          ? [[...ok, item], no]
          : [ok, [...no, item]],
      [[], []],
    )

    const results = await Promise.allSettled(
      allowed.map((i) => setArchived.mutateAsync({ id: i.id, archived: true })),
    )
    const refused = allowed.filter((_, at) => results[at]?.status === 'rejected')
    const archived = allowed.length - refused.length

    if (archived > 0) notify.success(t('archive.archived', { count: archived }))

    const skipped = [...refused, ...forbidden]
    if (skipped.length > 0) {
      // Named, and capped at three so one toast stays readable on a large selection.
      const named = skipped
        .slice(0, 3)
        .map((i) => i.itemKey)
        .join(', ')
      notify.error(
        t('archive.skipped', {
          count: skipped.length,
          items: named,
          more: skipped.length > 3 ? `, +${skipped.length - 3}` : '',
        }),
      )
      // Keep the problem rows selected; drop the ones that succeeded.
      selection.replace(new Set(skipped.map((i) => i.id)))
    } else {
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
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('searchPlaceholder'),
          ariaLabel: t('searchPlaceholder'),
          width: 200,
        }}
        activeFilterCount={(stateFilter !== 'all' ? 1 : 0) + (allProjects ? 1 : 0)}
        filters={
          <div className="flex flex-wrap items-center gap-4">
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

            {/* Scope. The selected project is the DEFAULT so the grid agrees with the
                header selector; "All projects" is the deliberate opt-out. Only offered
                when a project is actually selected — with none, "all" is all there is. */}
            {createProjectId && (
              <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
                {t('filters.project')}
                <InlineSelect
                  value={allProjects ? 'all' : 'current'}
                  aria-label={t('filters.project')}
                  onChange={(e) => setAllProjects(e.target.value === 'all')}
                  className="w-auto"
                >
                  <option value="current">
                    {project?.projectName ?? t('filters.currentProject')}
                  </option>
                  <option value="all">{t('filters.allProjects')}</option>
                </InlineSelect>
              </label>
            )}
          </div>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
        actions={
          // ONE CLICK, and the Type switcher beside the title decides what gets created —
          // viewing Features creates a Feature, viewing Epics creates an Epic. The label
          // follows the switcher so the button says what it will do before it is pressed.
          //
          // This replaces an `ActionMenu` offering `New Epic` / `New Feature`, which is what
          // SRS §4 and §11.2 describe ("opens a menu with…", acceptance 27). The menu made the
          // same choice twice: a planner already picked a level with the switcher, then picked
          // it again in a dropdown, and the two could disagree. Every other grid in the app
          // creates the kind of row it is showing — Iteration Status, the Tasks tab and the
          // Feature Children tab all do — so this is the app-wide pattern rather than a
          // Portfolio-only shortcut. Flagged for the BA: those three lines need amending.
          canCreate ? (
            <Button size="sm" onClick={() => setCreateType(type)}>
              <Plus size={13} />{' '}
              {type === PortfolioItemType.Epic ? t('create.titleEpic') : t('create.titleFeature')}
            </Button>
          ) : undefined
        }
        bulkActions={(selection) => (
          <>
            {/* §464: `Edit` is "Enabled for exactly one selection and opens that Portfolio Item's
                normal Detail page". One row, because there is no multi-item edit form and the BA does
                not ask for one. DISABLED rather than hidden on a wider selection, so the rule is
                visible: the label says what is available, the state says why it is not yet. */}
            <BulkActionButton
              label={t('bulk.edit')}
              icon={<Pencil size={12} />}
              disabled={selection.count !== 1}
              title={selection.count === 1 ? undefined : t('bulk.editOneOnly')}
              onClick={() => {
                const [only] = [...selection.selectedIds]
                if (only) openDetail(only)
              }}
            />
            <BulkActionButton
              destructive
              label={t('archive.action')}
              icon={<Archive size={12} />}
              disabled={setArchived.isPending}
              onClick={() => setConfirmArchive(true)}
            />
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
        items={sorted}
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
              /* `filterHidesEpics` wins over the search message: the reason there is nothing to
                 show is the Team+Epic pair, not the search box, and the BA quotes this string
                 verbatim (FR-035). */
              title={
                filterHidesEpics ? t('filterNotShowItem') : search ? t('emptySearch') : t('empty')
              }
            />
          ) : undefined
        }
        revealRowId={revealId}
        renderRow={(item, { gutterProps, revealed, rowNum }) => (
          <PortfolioRow
            key={item.id}
            item={item}
            rowNum={rowNum}
            moveHandlers={
              rowPerms.can(item.projectId, 'portfolio:edit') ? moveHandlers(item.id) : {}
            }
            revealed={revealed}
            canEdit={rowPerms.can(item.projectId, 'portfolio:edit')}
            members={members}
            canEditProject={canEditProject}
            options={optionsFor(item.projectId)}
            optionsFor={optionsFor}
            projects={projectOptions}
            colStyleFor={colStyleFor}
            gutterProps={gutterProps}
            onOpen={openDetail}
          />
        )}
      />

      {createType !== null && createProjectId && (
        <CreatePortfolioItemModal
          projectId={createProjectId}
          type={createType}
          onClose={() => setCreateType(null)}
          onCreated={setRevealId}
        />
      )}
    </>
  )
}
