/**
 * One capacity plan: its fields, its teams with their capacity, and the Features allocated
 * to each of them.
 *
 * `Breakdown` sits OUTSIDE the `canManage` toolbar on purpose. It reads numbers and changes
 * nothing, so a published plan — read-only until reverted — must still offer it; gating it
 * behind manage rights would hide the plan's totals from exactly the audience a published
 * plan exists for.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Send, Trash2, Undo2, Users } from 'lucide-react'

import { EmptyState } from '@/shared/ui/empty-state'
import { SkeletonList } from '@/shared/ui/skeleton'
import { DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { useDataTable } from '@/shared/ui/table'
import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { DetailLayout } from '@/shared/ui/detail'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { notify } from '@/shared/lib/toast'
import { useProjectPermissions } from '@/features/access/api'
import { useProjectTeams } from '@/features/teams/api'
import {
  useAddCapacityTeam,
  useRemoveAllocation,
  useRemoveCapacityTeam,
  useCapacityPlan,
  useDeleteCapacityPlan,
  usePublishPlan,
  useRevertPlan,
  type CapacityPlanItem,
  type CapacityPlanTeam,
} from '@/features/capacity-planning/api'
import { CAPACITY_STATUS_STYLE } from '@/features/capacity-planning/status-colors'
import {
  sortCapacityTeams,
  type CapacityTeamSortField,
} from '@/features/capacity-planning/sort-teams'
import { CutlineDivider } from '@/shared/ui/cutline-divider'
import {
  CAPACITY_ITEM_COLUMNS,
  CAPACITY_TEAM_COLUMNS,
  type ItemColKey,
  type TeamColKey,
} from './model/columns'
import { CapacityItemRow } from './ui/capacity-item-row'
import { ItemAllocationRow } from './ui/item-allocation-row'
import { PlanAssignmentCounts, PlanSummaryMetrics } from './ui/plan-summary-metrics'
import { CapacityTeamRow } from './ui/capacity-team-row'
import { TeamAllocationsTable } from './ui/team-allocations-table'
import { AllocateFeatureModal } from './ui/allocate-feature-modal'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ActionMenu, ActionMenuItem } from '@/shared/ui/action-menu'
import { SelectionModal } from '@/shared/ui/selection-modal'
import { CompositeBar } from '@/shared/ui/composite-bar'
import { CapacityBarTooltip } from './ui/capacity-bar-tooltip'
import { planTotals } from '@/features/capacity-planning/plan-totals'
import { CapacityForecastModal } from './ui/capacity-forecast-modal'
import { PublishPlanModal } from './ui/publish-plan-modal'
import { EditCapacityPlanModal } from './ui/edit-capacity-plan-modal'

export function CapacityPlanDetailPage() {
  const { t } = useTranslation('capacity')
  const navigate = useNavigate()
  const { planId } = useParams({ from: '/auth/capacity-planning/$planId' })
  const [tab, setTab] = useState('teams')
  const [showAllocate, setShowAllocate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showTeams, setShowTeams] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The team whose forecast is open, by plan-team id. One modal for every row rather than a
  // modal per row: only one can be open, and mounting N dialogs to show one is waste.
  const [forecastTeamId, setForecastTeamId] = useState<string | null>(null)
  const [showPublish, setShowPublish] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)
  /**
   * Teams whose allocated Features are shown.
   *
   * Collapsed by default, as Rally is: a plan with a dozen teams is a list of TEAMS, and
   * expanding every one by default buries the capacity comparison the tab exists for. The row
   * keeps a Feature count so a collapsed team still says how much it carries.
   */
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const toggleTeam = useCallback(
    (teamId: string) =>
      setExpandedTeams((prev) => {
        const next = new Set(prev)
        if (next.has(teamId)) next.delete(teamId)
        else next.add(teamId)
        return next
      }),
    [],
  )

  /**
   * Which Features show their per-team breakdown. Same collapsed-by-default rule as the team grid:
   * the tab exists to rank Features against the cutline, and every row expanded buries that.
   */
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const toggleItem = useCallback(
    (itemId: string) =>
      setExpandedItems((prev) => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      }),
    [],
  )

  const { data: plan, isLoading } = useCapacityPlan(planId)
  const { can } = useProjectPermissions(plan?.projectId)
  // A published plan is read-only until reverted, so the whole surface follows the API's
  // own rule rather than offering edits the server will refuse.
  const canManage = can('capacity:manage') && plan?.status === 'draft'

  // The PROJECT's teams, not every workspace team: a plan covers one project's release,
  // so those are the teams that can meaningfully carry its capacity. (The API validates
  // only workspace membership, deliberately looser, so a team helping across projects can
  // still be added by a caller that knows its id.)
  const { data: teams = [] } = useProjectTeams(plan?.projectId)
  const addTeam = useAddCapacityTeam()
  const removeTeam = useRemoveCapacityTeam()
  const removeAllocation = useRemoveAllocation()
  const revert = useRevertPlan()
  // Only for the pending flag on the toolbar button; the modal owns the publish call itself.
  const publish = usePublishPlan()
  const deletePlan = useDeleteCapacityPlan()
  // Publishing writes back to Feature rows, so it takes its OWN permission rather than
  // riding `capacity:manage` — a planner who may edit a draft is not automatically someone
  // who may stamp a release onto other people's Features.
  const canPublish = can('capacity:publish')

  // Client-side: the plan endpoint returns every team in one payload, so there is no page to
  // re-fetch and no server sort to ask for. Same `useTableSort` toggle semantics as every other
  // grid in the app, so clicking a header behaves identically here.
  const { sortField, sortDir, toggle } = useTableSort<CapacityTeamSortField>()

  const table = useDataTable<CapacityPlanTeam, unknown, TeamColKey>(CAPACITY_TEAM_COLUMNS, {
    storageKey: 'rally-capacity-team-columns',
    leadingWidth: 36,
    sort: {
      col: sortField ?? '',
      dir: sortDir ?? 'asc',
      onSort: (c) => toggle(c as CapacityTeamSortField),
    },
  })
  const colStyleFor = useCallback(
    (key: TeamColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
  )
  // Its own column layout and storage key: the Items tab shows different columns, and sharing a
  // key would let one tab's resize silently rearrange the other.
  const itemTable = useDataTable<CapacityPlanItem, unknown, ItemColKey>(CAPACITY_ITEM_COLUMNS, {
    storageKey: 'rally-capacity-item-columns',
  })
  const itemColStyleFor = useCallback(
    (key: ItemColKey, base?: React.CSSProperties) => itemTable.styleFor(key, base),
    [itemTable],
  )

  /** Allocations bucketed by team, so each team's Features render beneath it. */
  // Names live on the plan's team rows; the item row carries only the id, so resolve once here
  // rather than searching the team list per row.
  const teamNameById = useMemo(
    () => new Map(plan?.teams.map((team) => [team.teamId, team.teamName]) ?? []),
    [plan?.teams],
  )

  /**
   * A Feature's 1-based position in the plan's rank order, for the sub-table's `Rank` column.
   *
   * Built from `plan.items`, which the API already returns in rank order — the same numbering the
   * Features tab shows, so one Feature cannot be #3 on one tab and #1 on another.
   */
  const rankPositionOf = useCallback(
    (portfolioItemId: string) => {
      const index = (plan?.items ?? []).findIndex((i) => i.portfolioItemId === portfolioItemId)
      return index === -1 ? null : index + 1
    },
    [plan?.items],
  )

  /**
   * Who else holds a Feature — the input to Rally's `Allocation` cell.
   *
   * `owner` is the team whose allocation is primary; `contributors` are the rest. Both are NAMES,
   * resolved here because only the page has the plan's team list.
   */
  const sharingOf = useCallback(
    (portfolioItemId: string) => {
      const rows = (plan?.allocations ?? []).filter(
        (a) => a.portfolioItemId === portfolioItemId && a.teamId !== null,
      )
      const owner = rows.find((a) => a.isPrimary)?.teamId ?? null
      return {
        owner: owner === null ? null : (teamNameById.get(owner) ?? null),
        contributors: rows
          .filter((a) => !a.isPrimary && a.teamId !== null)
          .map((a) => teamNameById.get(a.teamId as string) ?? '—'),
      }
    },
    [plan?.allocations, teamNameById],
  )

  /** The same allocations bucketed by FEATURE, for the Features tab's nested rows. */
  const allocationsByItem = useMemo(() => {
    const map = new Map<string, NonNullable<typeof plan>['allocations']>()
    for (const a of plan?.allocations ?? []) {
      const list = map.get(a.portfolioItemId) ?? []
      list.push(a)
      map.set(a.portfolioItemId, list)
    }
    return map
  }, [plan?.allocations])

  const allocationsByTeam = useMemo(() => {
    const map = new Map<string, NonNullable<typeof plan>['allocations']>()
    for (const a of plan?.allocations ?? []) {
      if (a.teamId === null) continue
      const list = map.get(a.teamId) ?? []
      list.push(a)
      map.set(a.teamId, list)
    }
    return map
  }, [plan?.allocations])

  const sortedTeams = useMemo(
    () =>
      sortCapacityTeams(plan?.teams ?? [], sortField, sortDir, (teamId) =>
        (plan?.allocations ?? []).reduce((n, a) => (a.teamId === teamId ? n + 1 : n), 0),
      ),
    [plan?.teams, plan?.allocations, sortField, sortDir],
  )

  /** Demand parked without a team. */
  const unallocated = useMemo(
    () => (plan?.allocations ?? []).filter((a) => a.teamId === null),
    [plan?.allocations],
  )

  const openFeature = useCallback(
    (portfolioItemId: string) =>
      void navigate({ to: '/portfolio/$itemId', params: { itemId: portfolioItemId } }),
    [navigate],
  )

  async function removePlan() {
    try {
      await deletePlan.mutateAsync(planId)
      notify.success(t('delete.planDone'))
      // Back to the list: the page we are on no longer describes anything.
      void navigate({ to: '/capacity-planning' })
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('delete.failed'))
    } finally {
      setConfirmDelete(false)
    }
  }

  /**
   * Rally's `Remove Only`: takes a Feature off the plan.
   *
   * Deletes every allocation of it, across teams and the Unallocated bucket — the Feature is on the
   * plan because those rows exist, so removing it means removing them. The Feature itself is
   * untouched; this is a planning decision, not a portfolio one.
   */
  async function removeFeature(item: { portfolioItemId: string; itemKey: string }) {
    const rows = (plan?.allocations ?? []).filter((a) => a.portfolioItemId === item.portfolioItemId)
    try {
      for (const row of rows) {
        await removeAllocation.mutateAsync({ id: planId, allocationId: row.id })
      }
      notify.success(t('items.removed', { item: item.itemKey }))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('row.allocationRemoveFailed'))
    }
  }

  /**
   * Applies the dialog's selection as a DIFF against the plan's current teams.
   *
   * Removals first: a plan cannot hold a team twice, and doing them in one pass keeps the
   * intermediate states out of the cache. A team that still carries allocations makes the API
   * refuse — its demand is work a planner entered — and that error propagates to the modal.
   */
  async function saveTeams(ids: string[]) {
    const onPlan = new Set((plan?.teams ?? []).map((pt) => pt.teamId))
    const next = new Set(ids)
    for (const teamId of [...onPlan].filter((id) => !next.has(id))) {
      await removeTeam.mutateAsync({ id: planId, teamId })
    }
    for (const teamId of ids.filter((id) => !onPlan.has(id))) {
      await addTeam.mutateAsync({ id: planId, teamId })
    }
  }

  if (isLoading) return <SkeletonList rows={6} />
  if (!plan) return <EmptyState title={t('detail.notFound')} />

  const unitLabel = t(`units.${plan.unit}`)
  // The same totals the summary panel and the Breakdown overlay read, so the header bar cannot
  // disagree with the numbers printed beside it.
  const planWide = planTotals(plan)
  // Resolved from the plan on every render rather than held in state, so a refetch that
  // changes a team's capacity cannot leave the open modal showing a stale row.
  const forecastTeam = plan.teams.find((team) => team.teamId === forecastTeamId) ?? null

  return (
    <>
      <DetailLayout
        onBack={() => void navigate({ to: '/capacity-planning' })}
        backLabel={t('title')}
        // Rally leads its header with the plan's key (`PN697`); ours is `CP-<n>`. The shared header
        // already has the slot every work-item detail uses for it.
        itemKey={plan.planKey ?? undefined}
        title={plan.name}
        status={
          <div className="flex items-center gap-2">
            {/* Same `StatusBadge` + feature-owned colour map as releases, iterations, milestones
                and projects — a capacity plan's state should not be the one status in the app
                rendered as bare text. */}
            <StatusBadge style={CAPACITY_STATUS_STYLE[plan.status]} />
            {/* Light-on-dark, NOT the page's muted greys: this bar is `bg-primary-dark`, where
                `text-muted-foreground` on a subtle border is very nearly invisible. Same
                `bg-white/10` + `text-white` treatment the bar's own controls use. */}
            {plan.releaseName !== null && (
              <span className="rounded-sm bg-white/10 px-1.5 py-px text-ui-xs text-white">
                {plan.releaseName}
              </span>
            )}
            {/* The plan's window and its advisory ceiling. These used to live in a right-hand
                fields panel; this page has none (Rally's has none either, and the team grid needs
                the full width), so the facts that are not derivable from the grid ride the header
                instead of disappearing. */}
            {(plan.plannedStartDate !== null || plan.plannedEndDate !== null) && (
              <span className="rounded-sm bg-white/10 px-1.5 py-px text-ui-xs whitespace-nowrap text-white">
                {plan.plannedStartDate ?? '—'} → {plan.plannedEndDate ?? '—'}
              </span>
            )}
            <span className="text-ui-xs whitespace-nowrap text-white/70">
              {t('detail.fields.targetLoad')} {plan.targetLoadPct}%
            </span>
            {/* The PLAN's own bar, in the header — Rally's position for it. The same `CompositeBar`
                every team row draws, so the whole plan can be read as over or under before any row
                is scanned, and the header bar cannot layer or colour differently from the rows it
                summarises. */}
            <div className="w-56 shrink-0">
              <CompositeBar
                onDark
                complete={planWide.complete}
                rollup={planWide.rollup}
                estimated={planWide.estimated}
                capacity={planWide.capacity}
                targetLoadPct={plan.targetLoadPct}
                tooltip={
                  <CapacityBarTooltip
                    complete={planWide.complete}
                    rollup={planWide.rollup}
                    estimated={planWide.estimated}
                    capacity={planWide.capacity}
                  />
                }
              />
            </div>
          </div>
        }
        // No counts on the tabs: Rally does not badge them here, and the numbers are already on
        // the page — the team grid's row count and the summary panel's assigned/unassigned split
        // say the same thing without competing with the tab labels.
        tabs={[
          { key: 'teams', label: t('detail.tabs.teams') },
          // Rally's Features tab: the same plan seen by Feature rather than by team, and the only
          // surface its cutline belongs on.
          { key: 'items', label: t('detail.tabs.items') },
        ]}
        // Rally's Actions menu: the plan's rarer verbs, away from Publish. Delete is here rather
        // than as a toolbar button precisely because it is destructive and Publish is not.
        actions={
          canPublish || can('capacity:manage') ? (
            <ActionMenu ariaLabel={t('detail.actionsLabel')} onDark>
              {/* Drafts only — the API refuses an edit to a published plan, so offering it would
                  collect changes the server will reject. */}
              {plan.status === 'draft' && can('capacity:manage') && (
                <>
                  <ActionMenuItem
                    icon={<Pencil size={13} />}
                    label={t('edit.title')}
                    onClick={() => setShowEdit(true)}
                  />
                  {/* Rally keeps these here too: its plan page has NO toolbar row, and every verb
                      that changes a plan's shape sits behind the same `⋮` as Edit and Delete. */}
                  <ActionMenuItem
                    icon={<Users size={13} />}
                    label={t('teams.action')}
                    onClick={() => setShowTeams(true)}
                  />
                  <ActionMenuItem
                    icon={<Plus size={13} />}
                    label={t('allocate.action')}
                    onClick={() => setShowAllocate(true)}
                  />
                </>
              )}
              {/* One direction at a time: a draft publishes, a published plan can only revert —
                  which is also the only way back to editing it. */}
              {canPublish &&
                (plan.status === 'draft' ? (
                  <ActionMenuItem
                    icon={<Send size={13} />}
                    label={t('publish.action')}
                    onClick={() => setShowPublish(true)}
                    disabled={publish.isPending}
                  />
                ) : (
                  <ActionMenuItem
                    icon={<Undo2 size={13} />}
                    label={t('publish.revert.action')}
                    onClick={() => setConfirmRevert(true)}
                    disabled={revert.isPending}
                  />
                ))}
              {can('capacity:manage') && (
                <ActionMenuItem
                  icon={<Trash2 size={13} />}
                  label={t('delete.planAction')}
                  destructive
                  onClick={() => setConfirmDelete(true)}
                />
              )}
            </ActionMenu>
          ) : undefined
        }
        activeTab={tab}
        onTabChange={setTab}
      >
        {/* FULL WIDTH — no fields panel. Rally's capacity plan has none, and with one the eight
            team columns did not fit: the grid gained a horizontal scrollbar and Capacity, the base
            every percentage is taken from, fell off the right edge. Everything the panel held now
            lives in the header (window, target load), in the summary panel (unit, totals) or in the
            grid itself (per-team capacity, which the panel was repeating). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Rally's summary ROW: what the plan is planning on the left, how it measures up on
                the right. The measurements are a bordered panel rather than KPI cards, because the
                four figures are one reading of the plan and each needs the swatch of the bar
                segment it names. */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-inner px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ui-xs text-muted-foreground">{t('summary.itemType')}</span>
                {/* A plan of Features and a plan of Epics look identical otherwise. Ours only plans
                    Features today, so this states a fact rather than offering a choice. */}
                <span className="rounded-sm border border-border-subtle bg-surface-subtle px-1.5 py-px text-ui-xs font-semibold text-foreground">
                  {t('items.featureType')}
                </span>
                <PlanAssignmentCounts plan={plan} />
              </div>
              <PlanSummaryMetrics plan={plan} unitLabel={unitLabel} />
            </div>

            {/* No toolbar row: Rally's plan page has none. Every verb is in the header's `⋮`
                Actions menu, and the grid starts directly under the summary. */}
            {tab === 'items' ? (
              <DataTableFrame
                header={itemTable.headerProps}
                padClassName="px-3"
                empty={
                  plan.items.length === 0 ? (
                    <EmptyState
                      icon={<Users size={28} className="text-border-strong" />}
                      title={t('items.empty')}
                    />
                  ) : undefined
                }
              >
                {plan.items.map((item, index) => (
                  <div key={item.portfolioItemId}>
                    {/* The line sits ABOVE the first item that does not fit. `-1` means even
                          the first one exceeds the plan, so it lands at the very top; `null`
                          (no capacity entered anywhere) draws nothing, because there is no
                          number for the running total to exceed. */}
                    {plan.itemCutlineIndex !== null && plan.itemCutlineIndex + 1 === index && (
                      <CutlineDivider label={t('cutline.label')} />
                    )}
                    <CapacityItemRow
                      item={item}
                      position={index + 1}
                      primaryTeamName={teamNameById.get(item.primaryTeamId ?? '') ?? null}
                      belowCutline={plan.itemCutlineIndex !== null && index > plan.itemCutlineIndex}
                      expanded={expandedItems.has(item.portfolioItemId)}
                      onToggleExpanded={() => toggleItem(item.portfolioItemId)}
                      onRemove={canManage ? () => void removeFeature(item) : undefined}
                      colStyleFor={itemColStyleFor}
                      onOpenFeature={openFeature}
                    />
                    {/* Rally: "each allocated project is listed as a row underneath the portfolio
                        item". PLAIN nested rows here, not a sub-table: unlike the team grid, these
                        children fill the SAME columns as their parent (one team's slice of
                        Complete / Rollup / Estimated), so a second header would repeat the one
                        above it. */}
                    {expandedItems.has(item.portfolioItemId) &&
                      (allocationsByItem.get(item.portfolioItemId) ?? []).map((allocation) => (
                        <ItemAllocationRow
                          key={allocation.id}
                          allocation={allocation}
                          teamName={teamNameById.get(allocation.teamId ?? '') ?? null}
                          colStyleFor={itemColStyleFor}
                        />
                      ))}
                  </div>
                ))}
              </DataTableFrame>
            ) : (
              <DataTableFrame
                header={table.headerProps}
                padClassName="px-3"
                empty={
                  plan.teams.length === 0 ? (
                    <EmptyState
                      icon={<Users size={28} className="text-border-strong" />}
                      title={t('detail.noTeams')}
                    />
                  ) : undefined
                }
              >
                {sortedTeams.map((team) => (
                  <div key={team.id}>
                    <CapacityTeamRow
                      planId={plan.id}
                      team={team}
                      unitLabel={unitLabel}
                      targetLoadPct={plan.targetLoadPct}
                      canManage={canManage}
                      colStyleFor={colStyleFor}
                      gutter={null}
                      onForecast={() => setForecastTeamId(team.teamId)}
                      expanded={expandedTeams.has(team.teamId)}
                      onToggleExpanded={() => toggleTeam(team.teamId)}
                      featureCount={allocationsByTeam.get(team.teamId)?.length ?? 0}
                    />
                    {/* Allocated Features sit under their team — one row per team, which is
                          how Rally groups a shared Feature — and DISCLOSED rather than always
                          on, because Rally collapses them until asked. No cutline here either:
                          Rally draws it on the Items tab against the plan's total capacity. */}
                    {expandedTeams.has(team.teamId) && (
                      <TeamAllocationsTable
                        planId={plan.id}
                        allocations={allocationsByTeam.get(team.teamId) ?? []}
                        teamName={team.teamName}
                        canManage={canManage}
                        onOpenFeature={openFeature}
                        rankPositionOf={rankPositionOf}
                        sharingOf={sharingOf}
                      />
                    )}
                  </div>
                ))}

                {/* The Unallocated bucket. Rendered only when it holds something: an empty
                  section would imply demand is missing rather than simply absent. */}
                {unallocated.length > 0 && (
                  <div>
                    <div className="flex min-h-[34px] items-center border-b border-border-inner bg-surface-hover px-3 text-ui-md font-semibold text-foreground">
                      <span style={colStyleFor('team', { flexShrink: 0 })} className="px-2">
                        {t('detail.unallocated')}
                      </span>
                      <span
                        style={colStyleFor('capacity', { flexShrink: 0 })}
                        className="px-2 text-right tabular-nums"
                      >
                        {plan.unallocated} {unitLabel}
                      </span>
                    </div>
                    {/* Same nested table as a team's, so the bucket reads as one more group rather
                        than a different kind of list. No team by definition — the Unallocated
                        bucket is Rally's unassigned state, so there is nothing to make primary. */}
                    <TeamAllocationsTable
                      planId={plan.id}
                      allocations={unallocated}
                      teamName={null}
                      canManage={canManage}
                      onOpenFeature={openFeature}
                      rankPositionOf={rankPositionOf}
                      sharingOf={sharingOf}
                    />
                  </div>
                )}
              </DataTableFrame>
            )}
          </div>
        </div>
      </DetailLayout>

      {showEdit && <EditCapacityPlanModal plan={plan} onClose={() => setShowEdit(false)} />}

      {/* Reuses the shared `SelectionModal` — the same searchable checkbox list milestones use for
          their projects/teams/releases, so Rally's dialog costs no new component. Saving diffs the
          selection against the plan; the API refuses to drop a team that still carries demand, and
          that message is what the modal reports. */}
      <SelectionModal
        open={showTeams}
        onClose={() => setShowTeams(false)}
        title={t('teams.title')}
        items={teams.map((team) => ({ id: team.id, name: team.name }))}
        selectedIds={plan.teams.map((pt) => pt.teamId)}
        onSave={saveTeams}
      />

      {/* Deleting a PUBLISHED plan is allowed — Rally allows it too — so the message says what
          survives: the Release and dates the plan stamped onto its Features are those Features'
          data now, and only a revert takes them back. */}
      <ConfirmDialog
        open={confirmDelete}
        title={t('delete.planTitle')}
        message={
          plan.status === 'published' ? t('delete.publishedWarning') : t('delete.planMessage')
        }
        confirmLabel={t('delete.confirm')}
        destructive
        pending={deletePlan.isPending}
        onConfirm={() => void removePlan()}
        onCancel={() => setConfirmDelete(false)}
      />

      {showAllocate && <AllocateFeatureModal plan={plan} onClose={() => setShowAllocate(false)} />}
      {forecastTeam && (
        <CapacityForecastModal
          planId={plan.id}
          team={forecastTeam}
          unitLabel={unitLabel}
          canManage={canManage}
          onClose={() => setForecastTeamId(null)}
        />
      )}
      {showPublish && <PublishPlanModal plan={plan} onClose={() => setShowPublish(false)} />}
      <ConfirmDialog
        open={confirmRevert}
        title={t('publish.revert.title')}
        message={t('publish.revert.message')}
        confirmLabel={t('publish.revert.confirm')}
        pending={revert.isPending}
        onCancel={() => setConfirmRevert(false)}
        onConfirm={() => {
          revert.mutate(
            { id: plan.id },
            {
              // The toast repeats that the Feature fields were left alone — the dialog says it
              // too, but this is the moment a planner might expect an undo to have happened.
              onSuccess: () => notify.success(t('publish.revert.done')),
              onError: (err) => notify.error(err.message),
            },
          )
          setConfirmRevert(false)
        }}
      />
    </>
  )
}
