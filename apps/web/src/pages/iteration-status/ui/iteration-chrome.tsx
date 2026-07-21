import { type CSSProperties } from 'react'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Bug,
  ListChecks,
  BarChart3,
  List,
  LayoutGrid,
} from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { type DataTableHeaderColumn } from '@/shared/ui/data-table-header'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { Button } from '@/shared/ui/button'
import { InlineSelect } from '@/shared/ui/native-select'
import { MetricCard } from '@/shared/ui/metric-card'
import { RowGutter } from '@/shared/ui/row-gutter'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import {
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  type ScheduleState,
} from '@/entities/work-item/model/types'
import { fmtRange } from '../model/iteration-helpers'
import { type ColKey, OWNER_UNASSIGNED } from '../model/columns'

export function IterationHeader({
  iterations,
  selected,
  selectedId,
  selectedIndex,
  setSelectedId,
  move,
  selectorOpen,
  setSelectorOpen,
  viewMode,
  setViewMode,
}: {
  iterations: Iteration[]
  selected: Iteration | undefined
  selectedId: string | null
  selectedIndex: number
  setSelectedId: (id: string) => void
  move: (dir: -1 | 1) => void
  selectorOpen: boolean
  setSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>
  viewMode: 'list' | 'board'
  setViewMode: (mode: 'list' | 'board') => void
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 px-4"
      style={{
        height: 44,
        borderBottom: `1px solid ${BRAND.borderSubtle}`,
        backgroundColor: BRAND.surface,
      }}
    >
      <span
        style={{ fontSize: 16, fontWeight: 700, color: BRAND.textPrimary, whiteSpace: 'nowrap' }}
      >
        Iteration Status
      </span>
      <div
        className="flex items-center"
        style={{
          border: `1px solid ${BRAND.borderSubtle}`,
          borderRadius: 2,
          overflow: 'visible',
          height: 28,
        }}
      >
        <button
          disabled={selectedIndex <= 0}
          onClick={() => move(-1)}
          style={{
            height: '100%',
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            cursor: selectedIndex <= 0 ? 'not-allowed' : 'pointer',
            background: 'transparent',
            border: 'none',
            borderRight: `1px solid ${BRAND.borderSubtle}`,
            color: selectedIndex <= 0 ? BRAND.textMuted : BRAND.textSecondary,
            opacity: selectedIndex <= 0 ? 0.4 : 1,
          }}
          onMouseOver={(e) => {
            if (selectedIndex > 0) e.currentTarget.style.backgroundColor = BRAND.surfaceHover
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <ChevronLeft size={14} />
        </button>
        <div className="relative" style={{ height: '100%' }}>
          <button
            onClick={() => setSelectorOpen((o) => !o)}
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0 10px',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              minWidth: 300,
              color: BRAND.textPrimary,
              textAlign: 'left',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = BRAND.surfaceHover
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {selected?.name}
            </span>
            <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: BRAND.textSecondary }}>
              {selected && fmtRange(selected)}
            </span>
            <ChevronDown size={12} style={{ marginLeft: 'auto', color: BRAND.textMuted }} />
          </button>
          {selectorOpen && (
            <div
              className="absolute top-full left-0 z-50"
              style={{
                marginTop: 4,
                width: 380,
                backgroundColor: BRAND.surface,
                borderRadius: 2,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                border: `1px solid ${BRAND.borderSubtle}`,
                maxHeight: 300,
                overflowY: 'auto',
                padding: '4px 0',
              }}
            >
              {iterations.map((it) => (
                <button
                  key={it.id}
                  onClick={() => {
                    setSelectedId(it.id)
                    setSelectorOpen(false)
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    border: 'none',
                    background: selectedId === it.id ? BRAND.primaryLighter : 'transparent',
                    color: selectedId === it.id ? BRAND.primary : BRAND.textPrimary,
                    fontSize: 12,
                    textAlign: 'left',
                  }}
                  onMouseOver={(e) => {
                    if (selectedId !== it.id)
                      e.currentTarget.style.backgroundColor = BRAND.surfaceHover
                  }}
                  onMouseOut={(e) => {
                    if (selectedId !== it.id) e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span style={{ fontWeight: 600, flex: 1 }}>{it.name}</span>
                  <span style={{ color: BRAND.textMuted, fontSize: 11 }}>{fmtRange(it)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          disabled={selectedIndex >= iterations.length - 1}
          onClick={() => move(1)}
          style={{
            height: '100%',
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            cursor: selectedIndex >= iterations.length - 1 ? 'not-allowed' : 'pointer',
            background: 'transparent',
            border: 'none',
            borderLeft: `1px solid ${BRAND.borderSubtle}`,
            color: selectedIndex >= iterations.length - 1 ? BRAND.textMuted : BRAND.textSecondary,
            opacity: selectedIndex >= iterations.length - 1 ? 0.4 : 1,
          }}
          onMouseOver={(e) => {
            if (selectedIndex < iterations.length - 1)
              e.currentTarget.style.backgroundColor = BRAND.surfaceHover
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="flex-1" />
      {/* ── List / Board view toggle (BA spec) ──────────────────────────── */}
      <div
        className="flex items-center"
        style={{
          border: `1px solid ${BRAND.borderSubtle}`,
          borderRadius: 2,
          height: 28,
          overflow: 'hidden',
        }}
      >
        {(
          [
            { mode: 'list', Icon: List, label: 'List' },
            { mode: 'board', Icon: LayoutGrid, label: 'Board' },
          ] as const
        ).map(({ mode, Icon, label }, i) => {
          const active = viewMode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={active}
              title={`${label} view`}
              className="flex items-center gap-1.5"
              style={{
                height: '100%',
                padding: '0 10px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                borderLeft: i === 0 ? 'none' : `1px solid ${BRAND.borderSubtle}`,
                backgroundColor: active ? BRAND.primary : 'transparent',
                color: active ? BRAND.primaryForeground : BRAND.textSecondary,
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Metrics strip ────────────────────────────────────────────────────────────

export function MetricsStrip({
  metrics,
  velocityPct,
  acceptedPct,
  iterationEnd,
  iterationProgressPct,
}: {
  metrics: import('@/features/iterations/api').IterationStatus['metrics'] | undefined
  velocityPct: number
  acceptedPct: number
  iterationEnd: { value: string; label: string; color: string }
  iterationProgressPct: number
}) {
  return (
    <div
      className="flex shrink-0 items-stretch px-4"
      style={{
        height: 72,
        borderBottom: `1px solid ${BRAND.borderSubtle}`,
        backgroundColor: BRAND.surface,
        gap: 24,
      }}
    >
      {/* Left side: KPI cards from the iteration read-model */}
      <div className="flex items-stretch" style={{ gap: 32, flex: 1 }}>
        <MetricCard
          label="Planned Velocity"
          value={`${velocityPct}%`}
          caption={`${metrics?.totalPlanEstimate ?? 0} of ${metrics?.plannedVelocity ?? 0} Points`}
          progressPct={velocityPct}
          minWidth={160}
        />
        <MetricCard
          label="Iteration End"
          value={iterationEnd.value}
          valueColor={iterationEnd.color}
          caption={iterationEnd.label}
          progressPct={iterationProgressPct}
          progressColor={BRAND.textMuted}
          minWidth={140}
        />
        <MetricCard
          label="Accepted"
          value={`${acceptedPct}%`}
          valueColor={BRAND.success}
          caption={`${metrics?.acceptedPoints ?? 0} of ${metrics?.totalPlanEstimate ?? 0} Points`}
          progressPct={acceptedPct}
          progressColor={BRAND.success}
          minWidth={140}
        />
      </div>

      {/* Right side: Defects, Tasks, View Charts */}
      <div className="flex items-center" style={{ gap: 20 }}>
        <div className="flex items-center gap-2" style={{ minWidth: 90 }}>
          <Bug size={16} style={{ color: BRAND.textMuted }} />
          <div className="flex flex-col">
            <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.textPrimary }}>
              {metrics?.defectCount ?? 0} Active
            </span>
            <span style={{ fontSize: 10, color: BRAND.textMuted }}>Defects</span>
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ minWidth: 90 }}>
          <ListChecks size={16} style={{ color: BRAND.textMuted }} />
          <div className="flex flex-col">
            <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.textPrimary }}>
              {metrics?.activeTaskCount ?? 0} Active
            </span>
            <span style={{ fontSize: 10, color: BRAND.textMuted }}>Tasks</span>
          </div>
        </div>
        <button
          className="flex items-center gap-1.5"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: BRAND.primary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 2,
            whiteSpace: 'nowrap',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = BRAND.primaryLighter
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <BarChart3 size={14} />
          View Charts
        </button>
      </div>
    </div>
  )
}

// ── Toolbar (search + add + filter/fields placeholders) ────────────────────

export function Toolbar({
  search,
  setSearch,
  canCreate,
  onAddNew,
  columns,
  order,
  hidden,
  toggleVisible,
  reorder,
  stateFilter,
  setStateFilter,
  ownerFilter,
  setOwnerFilter,
  blockedOnly,
  setBlockedOnly,
  members,
}: {
  search: string
  setSearch: (v: string) => void
  canCreate: boolean
  onAddNew: () => void
  columns: ColumnDef<ColKey>[]
  order: ColKey[]
  hidden: Set<ColKey>
  toggleVisible: (key: ColKey) => void
  reorder: (dragKey: ColKey, overKey: ColKey) => void
  stateFilter: ScheduleState | 'all'
  setStateFilter: (v: ScheduleState | 'all') => void
  ownerFilter: string
  setOwnerFilter: (v: string) => void
  blockedOnly: boolean
  setBlockedOnly: (v: boolean) => void
  members: import('@/features/teams/api').ProjectMember[]
}) {
  const activeFilterCount =
    (stateFilter !== 'all' ? 1 : 0) + (ownerFilter !== 'all' ? 1 : 0) + (blockedOnly ? 1 : 0)
  return (
    <PageToolbar
      search={{
        value: search,
        onChange: setSearch,
        placeholder: 'Search Work Items',
        ariaLabel: 'Search work items',
        width: 220,
      }}
      actions={
        canCreate ? (
          <Button size="sm" onClick={onAddNew}>
            <Plus size={14} /> Add New
          </Button>
        ) : undefined
      }
      activeFilterCount={activeFilterCount}
      defaultFiltersOpen={activeFilterCount > 0}
      filters={
        <>
          <label
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: BRAND.textSecondary }}
          >
            State
            <InlineSelect
              value={stateFilter}
              aria-label="Filter by schedule state"
              onChange={(e) => setStateFilter(e.target.value as ScheduleState | 'all')}
              className="w-auto"
            >
              <option value="all">All States</option>
              {SCHEDULE_STATE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
                </option>
              ))}
            </InlineSelect>
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: BRAND.textSecondary }}
          >
            Owner
            <InlineSelect
              value={ownerFilter}
              aria-label="Filter by owner"
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="w-auto"
            >
              <option value="all">All Owners</option>
              <option value={OWNER_UNASSIGNED}>Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </InlineSelect>
          </label>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium"
            style={{ color: BRAND.textPrimary }}
          >
            <input
              type="checkbox"
              checked={blockedOnly}
              onChange={(e) => setBlockedOnly(e.target.checked)}
            />
            Blocked items only
          </label>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setStateFilter('all')
                setOwnerFilter('all')
                setBlockedOnly(false)
              }}
              className="cursor-pointer rounded px-2.5 py-1 text-[11px]"
              style={{ color: BRAND.primaryLight }}
            >
              Clear filters
            </button>
          )}
        </>
      }
      fields={
        <ColumnFieldsMenu
          columns={columns}
          order={order}
          hidden={hidden}
          onToggle={toggleVisible}
          onReorder={reorder}
        />
      }
    />
  )
}

// ── Table header row ─────────────────────────────────────────────────────────

// ── Header column metadata ──────────────────────────────────────────────────
// Drives the (single-source) header render: label, optional sort key, and
// alignment. Order mirrors ITERATION_STATUS_COLUMNS; visual position is driven
// by CSS `order` via styleFor, so the DOM order stays canonical.
const HEADER_META: DataTableHeaderColumn<ColKey>[] = [
  { key: 'rank', label: 'Rank', sortCol: 'rank', align: 'center' },
  { key: 'id', label: 'ID', sortCol: 'id' },
  { key: 'name', label: 'Name', sortCol: 'name' },
  { key: 'feature', label: 'Feature' },
  { key: 'iteration', label: 'Iteration' },
  { key: 'state', label: 'Schedule State', sortCol: 'scheduleState' },
  { key: 'block', label: 'Block', sortCol: 'block', align: 'center' },
  { key: 'blockedReason', label: 'Blocked Reason' },
  { key: 'planEstimate', label: 'Plan Est', sortCol: 'planEstimate', align: 'right' },
  { key: 'taskEstimate', label: 'Task Est', sortCol: 'taskEstimate', align: 'right' },
  { key: 'toDo', label: 'To Do', sortCol: 'toDo', align: 'right' },
  { key: 'tasksPct', label: 'Tasks' },
  { key: 'actual', label: 'Actual', align: 'right' },
  { key: 'owner', label: 'Owner', sortCol: 'owner' },
  { key: 'defects', label: 'Defects', align: 'center' },
  { key: 'defectStatus', label: 'Defect Status' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'devOwner', label: 'Dev Owner' },
]

// ── Table footer totals ──────────────────────────────────────────────────────

export function TableFooterTotals({
  colStyles,
  totals,
}: {
  colStyles: Record<string, CSSProperties>
  totals: { planEst: number; taskEst: number; toDoSum: number; count: number }
}) {
  return (
    <TableTotalsRow
      columns={HEADER_META}
      colStyles={colStyles}
      leading={<RowGutter dragDisabled />}
      label="Totals"
      values={{
        planEstimate: `${totals.planEst} Points`,
        taskEstimate: `${totals.taskEst} Hours`,
        toDo: `${totals.toDoSum} Hours`,
      }}
    />
  )
}
