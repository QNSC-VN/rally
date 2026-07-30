/**
 * Capacity Planning — the list of plans for the current project (BA spec §3.9).
 *
 * Single-project, unlike the Portfolio list: a plan belongs to exactly one project and the
 * API requires `projectId`, so this page gates on the selected project the way Releases and
 * Iterations do and shows a prompt when none is chosen.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, CalendarRange, Plus } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { ListPageScaffold } from '@/shared/ui/list-page/list-page-scaffold'
import { ListPageHeader } from '@/shared/ui/list-page/list-page-header'
import { useDataTable } from '@/shared/ui/table'
import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useCapacityPlans, type CapacityPlan } from '@/features/capacity-planning/api'
import { CAPACITY_PLAN_COLUMNS, type PlanColKey } from './model/columns'
import { CreateCapacityPlanModal } from './ui/create-capacity-plan-modal'

export function CapacityPlansPage() {
  const { t } = useTranslation('capacity')
  const navigate = useNavigate()
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canManage = can('capacity:manage')

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const table = useDataTable<CapacityPlan, unknown, PlanColKey>(CAPACITY_PLAN_COLUMNS, {
    storageKey: STORAGE_KEYS.CAPACITY_PLAN_COLUMNS,
    leadingWidth: 36,
  })
  const colStyleFor = useCallback(
    (key: PlanColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
  )

  const { data: plans = [], isLoading, isError } = useCapacityPlans(projectId)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return plans
    return plans.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.releaseName ?? '').toLowerCase().includes(q),
    )
  }, [plans, search])

  const { sortField, sortDir, toggle } = useTableSort<PlanColKey>()
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

  const stats = useMemo(
    () => ({
      total: plans.length,
      drafts: plans.filter((p) => p.status === 'draft').length,
      published: plans.filter((p) => p.status === 'published').length,
    }),
    [plans],
  )

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <p className="text-ui-lg text-foreground-subtle">{t('selectProject')}</p>
      </div>
    )
  }

  return (
    <>
      <ListPageScaffold<CapacityPlan, PlanColKey>
        header={<ListPageHeader title={t('title')} />}
        metrics={
          <MetricStrip>
            <MetricCard label={t('metrics.total')} value={stats.total} minWidth={90} />
            <MetricCard label={t('metrics.drafts')} value={stats.drafts} minWidth={90} />
            <MetricCard label={t('metrics.published')} value={stats.published} minWidth={100} />
          </MetricStrip>
        }
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('searchPlaceholder'),
          ariaLabel: t('searchPlaceholder'),
          width: 200,
        }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={13} /> {t('common:addNew')}
            </Button>
          ) : undefined
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
        // No bulk operations: a plan is deleted (if ever) from its own detail page, and
        // there is no multi-plan action in the spec.
        selectable={false}
        headerProps={table.headerProps}
        headerColumns={table.headerColumns}
        colStyles={table.colStyles}
        sort={{
          col: sortField ?? '',
          dir: sortDir ?? 'asc',
          onSort: (c) => toggle(c as PlanColKey),
        }}
        items={sorted}
        loading={isLoading}
        skeleton={{ rows: 6, cols: 6 }}
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
              icon={<CalendarRange size={32} className="text-border-strong" />}
              title={search ? t('emptySearch') : t('empty')}
            />
          ) : undefined
        }
        renderRow={(plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() =>
              void navigate({ to: '/capacity-planning/$planId', params: { planId: plan.id } })
            }
            className="group flex min-h-[34px] w-full items-center border-b border-border-inner px-3 text-left text-ui-md transition-colors hover:bg-primary-lighter"
          >
            <div style={colStyleFor('name', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="truncate font-medium text-foreground">{plan.name}</span>
            </div>
            <div style={colStyleFor('release', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="truncate text-muted-foreground">{plan.releaseName ?? '—'}</span>
            </div>
            <div style={colStyleFor('unit', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="text-muted-foreground">{t(`units.${plan.unit}`)}</span>
            </div>
            <div style={colStyleFor('status', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="text-muted-foreground">{t(`statuses.${plan.status}`)}</span>
            </div>
            <div
              style={colStyleFor('targetLoad', { flexShrink: 0 })}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {plan.targetLoadPct}%
            </div>
            <div
              style={colStyleFor('capacity', { flexShrink: 0 })}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {/* Blank when nobody has entered a capacity — not 0, which would read as
                  "no capacity available". */}
              {plan.totalCapacity === null ? '—' : plan.totalCapacity}
            </div>
          </button>
        )}
      />

      {showCreate && (
        <CreateCapacityPlanModal projectId={projectId} onClose={() => setShowCreate(false)} />
      )}
    </>
  )
}
