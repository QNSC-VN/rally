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

export function CapacityPlanDetailPage() {
  const { t } = useTranslation('capacity')
  const navigate = useNavigate()
  const { planId } = useParams({ from: '/auth/capacity-planning/$planId' })
  const [tab, setTab] = useState('teams')
  const [addingTeamId, setAddingTeamId] = useState('')

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
                <CapacityTeamRow
                  key={team.id}
                  planId={plan.id}
                  team={team}
                  unitLabel={unitLabel}
                  canManage={canManage}
                  colStyleFor={colStyleFor}
                  gutter={null}
                />
              ))}
            </DataTableFrame>
          </div>
        }
        sidebar={
          <div className="flex flex-col gap-3">
            <DetailField label={t('detail.fields.project')}>{plan.projectName ?? '—'}</DetailField>
            <DetailField label={t('detail.fields.release')}>{plan.releaseName ?? '—'}</DetailField>
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
  )
}
