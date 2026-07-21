/**
 * Quality / Defect Tracking — P3.4
 *
 * Shows defect metrics strip + filterable defect table for the active project.
 * SRS layout (row-number gutter, then columns): ID, Name, User Story, Severity,
 * Priority, State, Schedule State, Fixed In Build, Iteration, Submitted By, Owner
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { AlertTriangle, PackageOpen, Plus } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { RowGutter } from '@/shared/ui/row-gutter'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { BRAND } from '@/shared/config/brand'
import { Button } from '@/shared/ui/button'
import { BulkScheduleBar } from '@/features/work-items/ui/bulk-schedule-bar'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useDefects, qualityKeys, type DefectRow } from '@/features/quality/api'
import { useProjectMembers } from '@/features/teams/api'
import { useReleases } from '@/features/releases/api'
import { useIterations } from '@/features/iterations/api'
import { useRankAnyWorkItem } from '@/features/work-items/api'
import { useQueryClient } from '@tanstack/react-query'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { useDataTable, useRowRerank, DataTableFrame } from '@/shared/ui/table'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { QUALITY_COLUMNS, FilterSelect, LogDefectModal, DefectTableRow } from './ui/quality-parts'
import {
  type QualityColKey,
  type QualityCtx,
  SEVERITY_OPTIONS,
  FLOW_STATE_OPTIONS,
  PRIORITY_OPTIONS,
  DEFECT_STATE_OPTIONS,
} from './model/quality-config'

export function QualityPage() {
  const { t } = useTranslation('quality')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { project } = useAppContext()
  const { can } = useProjectPermissions(project?.projectId)
  // Defects are work items; the backend enforces defect mutations via
  // work_item:edit, so the page's inline-edit affordances gate on the same.
  const canManage = can('work_item:edit')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Toggle asc/desc on the active column, else switch to a new column (asc).
  // NOTE: never nest a setter inside another setter's updater — StrictMode
  // double-invokes updaters and would cancel the toggle.
  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )
  const table = useDataTable<DefectRow, QualityCtx, QualityColKey>(QUALITY_COLUMNS, {
    storageKey: STORAGE_KEYS.QUALITY_COLUMNS,
    leadingWidth: 84,
    sort: { col: sortCol, dir: sortDir, onSort: handleSort },
  })
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [envFilter, setEnvFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [releaseFilter, setReleaseFilter] = useState('all')
  const [rootCauseFilter, setRootCauseFilter] = useState('all')
  const [resolutionFilter, setResolutionFilter] = useState('all')
  const [defectStateFilter, setDefectStateFilter] = useState('all')
  const [showLogDefect, setShowLogDefect] = useState(false)
  const { data: members } = useProjectMembers(project?.projectId)
  const { data: releases } = useReleases(project?.projectId)

  const { data, isLoading, error } = useDefects(project?.projectId, {
    search: search || undefined,
    severity: severityFilter,
    environment: envFilter,
    priority: priorityFilter,
    scheduleState: stateFilter,
    assigneeId: ownerFilter !== 'all' ? ownerFilter : undefined,
    releaseId: releaseFilter !== 'all' ? releaseFilter : undefined,
    rootCause: rootCauseFilter,
    resolution: resolutionFilter,
    defectState: defectStateFilter,
    sort: sortCol ? `${sortCol}:${sortDir}` : undefined,
  })

  // Server-side sorted (the `sort` param drives the ORDER BY), so the rows are
  // already in display order — no client re-sort.
  const defects = useMemo(() => data?.data ?? [], [data])
  // Row drag-to-rerank (shared engine capability). Disabled while a column
  // sort is active — rank only has meaning in natural rank order.
  const rankMutation = useRankAnyWorkItem()
  const rerank = useRowRerank({
    items: defects,
    disabled: sortCol !== null,
    onReorder: ({ id, beforeId, afterId }) =>
      rankMutation.mutate(
        {
          id,
          projectId: project?.projectId ?? '',
          beforeId: beforeId ?? undefined,
          afterId: afterId ?? undefined,
        },
        { onError: (err) => toast.error(err.message) },
      ),
  })

  // ── Bulk selection (shared pattern: checkbox gutter + BulkScheduleBar) ────────
  const { data: iterations = [] } = useIterations(project?.projectId)
  const {
    selectedIds,
    allSelected,
    someSelected,
    isSelected,
    toggle: toggleSelect,
    toggleAll,
    clear: clearSelection,
  } = useRowSelection(defects)

  const metrics = data?.metrics ?? {
    openDefects: 0,
    critical: 0,
    inProgress: 0,
    verifiedAccepted: 0,
    reopened: 0,
    blockers: 0,
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <AlertTriangle size={32} className="text-destructive" />
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t('errors.loadFailed')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Metrics strip */}
      <MetricStrip>
        <MetricCard
          label={t('metrics.openDefects')}
          value={metrics.openDefects}
          valueColor={BRAND.warning}
          minWidth={100}
        />
        <MetricCard
          label={t('metrics.critical')}
          value={metrics.critical}
          valueColor={BRAND.danger}
          minWidth={80}
        />
        <MetricCard
          label={t('metrics.inProgress')}
          value={metrics.inProgress}
          valueColor={BRAND.primaryLight}
          minWidth={90}
        />
        <MetricCard
          label={t('metrics.verifiedAccepted')}
          value={metrics.verifiedAccepted}
          valueColor={BRAND.success}
          minWidth={130}
        />
        <MetricCard
          label={t('metrics.reopened')}
          value={metrics.reopened}
          valueColor={BRAND.textPrimary}
          minWidth={90}
        />
        <MetricCard
          label={t('metrics.blockers')}
          value={metrics.blockers}
          valueColor={metrics.blockers > 0 ? BRAND.danger : BRAND.textPrimary}
          minWidth={80}
        />
      </MetricStrip>

      {/* Toolbar */}
      <PageToolbar
        title={t('title')}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search defects…',
          ariaLabel: 'Search defects',
          width: 160,
        }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setShowLogDefect(true)}>
              <Plus size={12} />
              {t('logDefect')}
            </Button>
          ) : undefined
        }
        activeFilterCount={
          (severityFilter !== 'all' ? 1 : 0) +
          (envFilter !== 'all' ? 1 : 0) +
          (priorityFilter !== 'all' ? 1 : 0) +
          (stateFilter !== 'all' ? 1 : 0) +
          (defectStateFilter !== 'all' ? 1 : 0) +
          (ownerFilter !== 'all' ? 1 : 0) +
          (releaseFilter !== 'all' ? 1 : 0) +
          (rootCauseFilter !== 'all' ? 1 : 0) +
          (resolutionFilter !== 'all' ? 1 : 0)
        }
        filters={
          <>
            <FilterSelect
              label="Severity"
              value={severityFilter}
              onChange={setSeverityFilter}
              options={[{ value: 'all', label: t('filters.allSeverity') }, ...SEVERITY_OPTIONS]}
            />

            <FilterSelect
              label="Environment"
              value={envFilter}
              onChange={setEnvFilter}
              options={[
                { value: 'all', label: t('filters.allEnv') },
                { value: 'development', label: t('filters.development') },
                { value: 'staging', label: t('filters.staging') },
                { value: 'production', label: t('filters.production') },
                { value: 'testing', label: t('filters.testing') },
              ]}
            />

            <FilterSelect
              label="Priority"
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={[{ value: 'all', label: t('filters.allPriority') }, ...PRIORITY_OPTIONS]}
            />

            <FilterSelect
              label="Flow State"
              value={stateFilter}
              onChange={setStateFilter}
              options={[{ value: 'all', label: t('filters.allFlowStates') }, ...FLOW_STATE_OPTIONS]}
            />

            <FilterSelect
              label="Defect State"
              value={defectStateFilter}
              onChange={setDefectStateFilter}
              options={[
                { value: 'all', label: t('filters.allDefectStates') },
                ...DEFECT_STATE_OPTIONS,
              ]}
            />

            <FilterSelect
              label="Owner"
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { value: 'all', label: t('filters.allOwners') },
                ...(members ?? []).map((m) => ({
                  value: m.userId,
                  label: m.displayName ?? m.email ?? m.userId,
                })),
              ]}
            />

            <FilterSelect
              label="Release"
              value={releaseFilter}
              onChange={setReleaseFilter}
              options={[
                { value: 'all', label: t('filters.allReleases') },
                ...(releases ?? []).map((r) => ({ value: r.id, label: r.name })),
              ]}
            />

            <FilterSelect
              label="Root Cause"
              value={rootCauseFilter}
              onChange={setRootCauseFilter}
              options={[
                { value: 'all', label: t('filters.allRootCauses') },
                { value: 'requirements', label: t('filters.requirements') },
                { value: 'design', label: t('filters.design') },
                { value: 'code', label: t('filters.code') },
                { value: 'test', label: t('filters.test') },
                { value: 'integration', label: t('filters.integration') },
                { value: 'other', label: t('filters.other') },
              ]}
            />

            <FilterSelect
              label="Resolution"
              value={resolutionFilter}
              onChange={setResolutionFilter}
              options={[
                { value: 'all', label: t('filters.allResolutions') },
                { value: 'unresolved', label: t('filters.unresolved') },
                { value: 'fixed', label: t('filters.fixed') },
                { value: 'wont_fix', label: t('filters.wontFix') },
                { value: 'duplicate', label: t('filters.duplicate') },
                { value: 'cannot_reproduce', label: t('filters.cannotReproduce') },
                { value: 'deferred', label: t('filters.deferred') },
                { value: 'by_design', label: t('filters.byDesign') },
              ]}
            />
          </>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* Bulk action bar — appears when ≥1 defect is selected */}
      <BulkScheduleBar
        projectId={project?.projectId}
        selectedIds={selectedIds}
        clearSelection={clearSelection}
        releases={releases ?? []}
        iterations={iterations}
        canEdit={canManage}
        onAssigned={() => qc.invalidateQueries({ queryKey: qualityKeys.all })}
      />

      {/* Defect table */}
      <div className="flex flex-1 overflow-hidden">
        <DataTableFrame
          header={table.headerProps}
          padClassName="gap-2 px-3"
          leading={
            <>
              <RowGutter
                dragDisabled
                checkbox={{
                  checked: allSelected,
                  indeterminate: someSelected,
                  onChange: toggleAll,
                  ariaLabel: 'Select all',
                }}
              />
              <div className="w-6 shrink-0 px-2 text-right">#</div>
            </>
          }
          loading={isLoading}
          skeleton={{ rows: 8 }}
          empty={
            defects.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
                <PackageOpen size={40} className="text-foreground-faint" />
                <p className="text-sm text-foreground-subtle">
                  {search ||
                  severityFilter !== 'all' ||
                  envFilter !== 'all' ||
                  priorityFilter !== 'all' ||
                  stateFilter !== 'all'
                    ? t('empty.noMatch')
                    : t('empty.none')}
                </p>
              </div>
            ) : undefined
          }
        >
          <DndContext {...rerank.dndContextProps}>
            <SortableContext {...rerank.sortableContextProps}>
              {rerank.items.map((d, idx) => (
                <DefectTableRow
                  key={d.id}
                  defect={d}
                  rowNum={idx + 1}
                  canManage={canManage}
                  projectId={project?.projectId ?? ''}
                  dragDisabled={sortCol !== null}
                  selected={isSelected(d.id)}
                  onToggleSelect={() => toggleSelect(d.id)}
                  openItem={(k) => navigate({ to: '/item/$itemKey', params: { itemKey: k } })}
                  renderCells={table.renderCells}
                />
              ))}
            </SortableContext>
          </DndContext>
        </DataTableFrame>
      </div>

      {/* Log Defect Modal */}
      {showLogDefect && (
        <LogDefectModal
          projectId={project?.projectId ?? ''}
          onClose={() => setShowLogDefect(false)}
        />
      )}
    </div>
  )
}
