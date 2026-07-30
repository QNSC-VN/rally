/**
 * One capacity plan: its fields, its teams, and each team's manually entered capacity.
 *
 * Allocations — the demand side, and therefore the Complete / Rollup / Estimated columns
 * and the composite capacity bar — arrive in the next slice. This page deliberately shows
 * only what exists: showing those columns now would render zeros and imply the numbers
 * were measured rather than absent.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Plus, Users } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { SkeletonList } from '@/shared/ui/skeleton'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { useDataTable } from '@/shared/ui/table'
import { DetailField, DetailLayout, DetailTwoPane } from '@/shared/ui/detail'
import { notify } from '@/shared/lib/toast'
import { useProjectPermissions } from '@/features/access/api'
import { useProjectTeams } from '@/features/teams/api'
import {
  useAddCapacityTeam,
  useCapacityPlan,
  type CapacityPlanTeam,
} from '@/features/capacity-planning/api'
import { CAPACITY_TEAM_COLUMNS, type TeamColKey } from './model/columns'
import { CapacityTeamRow } from './ui/capacity-team-row'
import { AllocationRow } from './ui/allocation-row'
import { AllocateFeatureModal } from './ui/allocate-feature-modal'

export function CapacityPlanDetailPage() {
  const { t } = useTranslation('capacity')
  const navigate = useNavigate()
  const { planId } = useParams({ from: '/auth/capacity-planning/$planId' })
  const [tab, setTab] = useState('teams')
  const [addingTeamId, setAddingTeamId] = useState('')
  const [showAllocate, setShowAllocate] = useState(false)

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
              {canManage && (
                <div className="flex items-center gap-2 border-b border-border-inner px-4 py-2">
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
                </div>
              )}

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
                    />
                    {/* Allocated Features sit under their team, which is how Rally groups a
                      shared Feature: one row per team, not one row per Feature. */}
                    {allocationsByTeam.get(team.teamId)?.map((allocation) => (
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
    </>
  )
}
