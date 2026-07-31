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
import { BarChart3, Plus, Send, Undo2, Users } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { SkeletonList } from '@/shared/ui/skeleton'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { useDataTable } from '@/shared/ui/table'
import { DetailField, DetailLayout, DetailTwoPane } from '@/shared/ui/detail'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { notify } from '@/shared/lib/toast'
import { useProjectPermissions } from '@/features/access/api'
import { useProjectTeams } from '@/features/teams/api'
import {
  useAddCapacityTeam,
  useCapacityPlan,
  usePublishPlan,
  useRevertPlan,
  type CapacityPlanTeam,
} from '@/features/capacity-planning/api'
import { planTotals, pctOfCapacity } from '@/features/capacity-planning/plan-totals'
import { CAPACITY_TEAM_COLUMNS, type TeamColKey } from './model/columns'
import { CapacityTeamRow } from './ui/capacity-team-row'
import { AllocationRow } from './ui/allocation-row'
import { AllocateFeatureModal } from './ui/allocate-feature-modal'
import { BRAND } from '@/shared/config/brand'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { CutlineDivider } from '@/shared/ui/cutline-divider'
import { CapacityBreakdownOverlay } from './ui/capacity-breakdown-overlay'
import { CapacityForecastModal } from './ui/capacity-forecast-modal'
import { PublishPlanModal } from './ui/publish-plan-modal'

export function CapacityPlanDetailPage() {
  const { t } = useTranslation('capacity')
  const navigate = useNavigate()
  const { planId } = useParams({ from: '/auth/capacity-planning/$planId' })
  const [tab, setTab] = useState('teams')
  const [addingTeamId, setAddingTeamId] = useState('')
  const [showAllocate, setShowAllocate] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  // The team whose forecast is open, by plan-team id. One modal for every row rather than a
  // modal per row: only one can be open, and mounting N dialogs to show one is waste.
  const [forecastTeamId, setForecastTeamId] = useState<string | null>(null)
  const [showPublish, setShowPublish] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)

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
  const revert = useRevertPlan()
  // Only for the pending flag on the toolbar button; the modal owns the publish call itself.
  const publish = usePublishPlan()
  // Publishing writes back to Feature rows, so it takes its OWN permission rather than
  // riding `capacity:manage` — a planner who may edit a draft is not automatically someone
  // who may stamp a release onto other people's Features.
  const canPublish = can('capacity:publish')

  const table = useDataTable<CapacityPlanTeam, unknown, TeamColKey>(CAPACITY_TEAM_COLUMNS, {
    storageKey: 'rally-capacity-team-columns',
    leadingWidth: 36,
  })
  const colStyleFor = useCallback(
    (key: TeamColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
  )

  /** Allocations bucketed by team, so each team's Features render beneath it. */
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

  // Teams already on the plan cannot be added twice, so they are not offered.
  const available = useMemo(() => {
    const onPlan = new Set((plan?.teams ?? []).map((pt) => pt.teamId))
    return teams.filter((team) => !onPlan.has(team.id))
  }, [teams, plan?.teams])

  function add() {
    if (!addingTeamId) return
    addTeam.mutate(
      { id: planId, teamId: addingTeamId },
      {
        onSuccess: () => {
          notify.success(t('row.teamAdded'))
          setAddingTeamId('')
        },
        onError: (err) => notify.error(err.message),
      },
    )
  }

  if (isLoading) return <SkeletonList rows={6} />
  if (!plan) return <EmptyState title={t('detail.notFound')} />

  const unitLabel = t(`units.${plan.unit}`)
  // Resolved from the plan on every render rather than held in state, so a refetch that
  // changes a team's capacity cannot leave the open modal showing a stale row.
  const forecastTeam = plan.teams.find((team) => team.teamId === forecastTeamId) ?? null
  const totals = planTotals(plan)
  /** "12 points · 40%" — the percentage is omitted when no capacity gives it a base. */
  const captionFor = (value: number) => {
    const pct = pctOfCapacity(value, totals.capacity)
    return pct === null ? unitLabel : `${unitLabel} · ${pct}%`
  }

  return (
    <>
      <DetailLayout
        onBack={() => void navigate({ to: '/capacity-planning' })}
        backLabel={t('title')}
        title={plan.name}
        status={<span className="text-ui-sm">{t(`statuses.${plan.status}`)}</span>}
        tabs={[{ key: 'teams', label: t('detail.tabs.teams'), count: plan.teams.length }]}
        activeTab={tab}
        onTabChange={setTab}
      >
        <DetailTwoPane
          main={
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Rally's plan summary: the four Breakdown numbers as a header strip, plus the
                  assigned/unassigned split it shows beside them. Same `MetricStrip` chrome as
                  every other read-model summary in the app, and the same `planTotals` the
                  Breakdown overlay reads — the header cannot disagree with the table. */}
              <MetricStrip>
                <MetricCard
                  label={t('breakdown.complete')}
                  value={totals.complete}
                  caption={captionFor(totals.complete)}
                  minWidth={110}
                />
                <MetricCard
                  label={t('breakdown.rollup')}
                  value={totals.rollup}
                  caption={captionFor(totals.rollup)}
                  minWidth={110}
                />
                <MetricCard
                  label={t('breakdown.estimated')}
                  value={totals.estimated}
                  caption={captionFor(totals.estimated)}
                  minWidth={110}
                />
                <MetricCard
                  label={t('breakdown.capacity')}
                  value={
                    totals.capacity === null ? (
                      <span className="text-ui-sm font-normal text-foreground-subtle">
                        {t('row.notEntered')}
                      </span>
                    ) : (
                      totals.capacity
                    )
                  }
                  // No unit caption when there is no number: "Not entered points" reads as a
                  // quantity of nothing rather than an unanswered question.
                  caption={totals.capacity === null ? undefined : unitLabel}
                  minWidth={130}
                />
                <MetricCard
                  label={t('summary.assigned')}
                  value={totals.assignedItems}
                  minWidth={90}
                />
                <MetricCard
                  label={t('summary.unassigned')}
                  value={totals.unassignedItems}
                  // Rally shows the unassigned count in YELLOW when there is one: it is the
                  // number that means work in this plan has nowhere to go.
                  valueColor={totals.unassignedItems > 0 ? BRAND.warning : undefined}
                  minWidth={100}
                />
              </MetricStrip>

              <div className="flex items-center gap-2 border-b border-border-inner px-4 py-2">
                {canManage && (
                  <>
                    <div className="w-64">
                      <SearchableSelect
                        variant="field"
                        value={addingTeamId}
                        ariaLabel={t('detail.addTeamLabel')}
                        options={available.map((team) => ({ value: team.id, label: team.name }))}
                        onChange={(v) => setAddingTeamId(v ?? '')}
                      />
                    </div>
                    <Button size="sm" onClick={add} disabled={!addingTeamId || addTeam.isPending}>
                      <Plus size={13} /> {t('detail.addTeam')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setShowAllocate(true)}>
                      <Plus size={13} /> {t('allocate.action')}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setShowBreakdown(true)}
                >
                  <BarChart3 size={13} /> {t('breakdown.action')}
                </Button>
                {/* One button, whichever direction the plan can move in. A draft can be
                    published; a published plan can only be reverted, which is also the only
                    way back to editing it. */}
                {canPublish &&
                  (plan.status === 'draft' ? (
                    <Button
                      size="sm"
                      onClick={() => setShowPublish(true)}
                      disabled={publish.isPending}
                    >
                      <Send size={13} /> {t('publish.action')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setConfirmRevert(true)}
                      disabled={revert.isPending}
                    >
                      <Undo2 size={13} /> {t('publish.revert.action')}
                    </Button>
                  ))}
              </div>

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
                {plan.teams.map((team) => (
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
                    />
                    {/* Allocated Features sit under their team, which is how Rally groups a
                      shared Feature: one row per team, not one row per Feature.
                      They arrive in RANK order, which is what makes the cutline meaningful. */}
                    {allocationsByTeam.get(team.teamId)?.map((allocation, index) => (
                      <div key={allocation.id}>
                        {/* Above the FIRST row when index is -1: nothing this team holds fits.
                            `null` (no capacity entered) draws no line at all — there is no
                            number to divide against, and a line at the top would claim there
                            is. */}
                        {team.cutlineIndex !== null && team.cutlineIndex + 1 === index && (
                          <CutlineDivider label={t('cutline.label')} />
                        )}
                        <AllocationRow
                          planId={plan.id}
                          allocation={allocation}
                          unitLabel={unitLabel}
                          canManage={canManage}
                          colStyleFor={colStyleFor}
                          onOpenFeature={openFeature}
                          belowCutline={team.cutlineIndex !== null && index > team.cutlineIndex}
                        />
                      </div>
                    ))}
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
                    {unallocated.map((allocation) => (
                      <AllocationRow
                        key={allocation.id}
                        planId={plan.id}
                        allocation={allocation}
                        unitLabel={unitLabel}
                        canManage={canManage}
                        colStyleFor={colStyleFor}
                        onOpenFeature={openFeature}
                      />
                    ))}
                  </div>
                )}
              </DataTableFrame>
            </div>
          }
          sidebar={
            <div className="flex flex-col gap-3">
              <DetailField label={t('detail.fields.project')}>
                {plan.projectName ?? '—'}
              </DetailField>
              <DetailField label={t('detail.fields.release')}>
                {plan.releaseName ?? '—'}
              </DetailField>
              <DetailField label={t('detail.fields.unit')}>{unitLabel}</DetailField>
              <DetailField label={t('detail.fields.targetLoad')}>{plan.targetLoadPct}%</DetailField>
              <DetailField label={t('detail.fields.totalCapacity')}>
                {/* Blank rather than 0 when nobody has entered a capacity: an untouched plan
                  is not a plan with no capacity available. */}
                {plan.totalCapacity === null ? (
                  <span className="text-foreground-subtle">{t('row.notEntered')}</span>
                ) : (
                  `${plan.totalCapacity} ${unitLabel}`
                )}
              </DetailField>
              <DetailField label={t('detail.fields.plannedStartDate')}>
                {plan.plannedStartDate ?? '—'}
              </DetailField>
              <DetailField label={t('detail.fields.plannedEndDate')}>
                {plan.plannedEndDate ?? '—'}
              </DetailField>
            </div>
          }
        />
      </DetailLayout>

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
      {showBreakdown && (
        <CapacityBreakdownOverlay
          plan={plan}
          unitLabel={unitLabel}
          onClose={() => setShowBreakdown(false)}
        />
      )}
    </>
  )
}
