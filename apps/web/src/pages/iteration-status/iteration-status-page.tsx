/**
 * Track › Iteration Status — P2.3
 *
 * Tracking view over the work items assigned to one selected iteration:
 * selector (prev/next + dropdown), metric strip (from the backend read-model),
 * and an editable work-item list. Add Item creates a Story/Defect directly in
 * the selected iteration. Sourced from /v1/iterations/:id/status.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import {
  useIterations,
  useIterationStatus,
  useCreateIterationItem,
  type Iteration,
  type IterationStatusItem,
} from '@/features/iterations/api'
import { useUpdateWorkItem } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { ScheduleStateBadge } from '@/entities/work-item/ui/badges'
import {
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  type ScheduleState,
} from '@/entities/work-item/model/types'

function fmtRange(it: Pick<Iteration, 'startDate' | 'endDate'>) {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} → ${e}`
}

export function IterationStatusPage() {
  const navigate = useNavigate()
  const { project } = useAppContext()
  const projectId = project?.projectId
  const canEdit = useAuthStore((s) => s.hasPermission('work_item:edit'))
  const canCreate = useAuthStore((s) => s.hasPermission('work_item:create'))

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)

  // O(1) member lookup — avoids O(n×m) per-row array scan
  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  )
  // Explicit user choice; falls back to the first iteration until one is picked.
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  // Derive the effective selection during render (no setState-in-effect): the
  // chosen id when it's still present, otherwise the first iteration.
  const selectedId =
    chosenId && iterations.some((i) => i.id === chosenId)
      ? chosenId
      : (iterations[0]?.id ?? null)
  const setSelectedId = setChosenId

  const { data: status, isLoading } = useIterationStatus(selectedId ?? undefined, {
    q: search.trim() || undefined,
  })

  const selectedIndex = useMemo(
    () => iterations.findIndex((i) => i.id === selectedId),
    [iterations, selectedId],
  )
  const selected = iterations[selectedIndex]

  function move(dir: -1 | 1) {
    const next = selectedIndex + dir
    if (next >= 0 && next < iterations.length) setSelectedId(iterations[next].id)
  }

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px]" style={{ color: BRAND.textMuted }}>
        Select a project to view Iteration Status.
      </div>
    )
  }

  if (!iterations.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px]" style={{ color: BRAND.textMuted }}>
        <span>No iterations in this project/team yet.</span>
        <button onClick={() => navigate({ to: '/timeboxes' })} className="cursor-pointer text-[12px] font-semibold hover:underline" style={{ color: BRAND.primaryLight }}>
          Go to Timeboxes →
        </button>
      </div>
    )
  }

  const metrics = status?.metrics
  const velocityPct = metrics?.plannedVelocityPercent ?? 0

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Selector bar */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
        <span className="text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Iteration
        </span>
        <div className="flex items-center rounded overflow-visible" style={{ border: '1px solid #bdd0ef', height: 28 }}>
          <button disabled={selectedIndex <= 0} onClick={() => move(-1)} className="h-full px-2 flex items-center cursor-pointer hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40" style={{ color: BRAND.primaryLight, borderRight: `1px solid ${BRAND.borderSubtle}` }}>
            <ChevronLeft size={14} />
          </button>
          <div className="relative h-full">
            <button onClick={() => setSelectorOpen((o) => !o)} className="h-full flex cursor-pointer items-center gap-3 px-3 text-left bg-white hover:bg-[#f7f9fc]" style={{ minWidth: 280, color: BRAND.textPrimary }}>
              <span className="text-[12px] font-semibold whitespace-nowrap">{selected?.name}</span>
              <span className="text-[11px] whitespace-nowrap" style={{ color: BRAND.textSecondary }}>
                {selected && fmtRange(selected)}
              </span>
              <ChevronDown size={12} className="ml-auto" style={{ color: BRAND.textSecondary }} />
            </button>
            {selectorOpen && (
              <div className="absolute left-0 top-full mt-1 w-full bg-white rounded shadow-lg z-50 py-1 max-h-72 overflow-auto" style={{ border: `1px solid ${BRAND.border}` }}>
                {iterations.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => {
                      setSelectedId(it.id)
                      setSelectorOpen(false)
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f4f6f9]"
                    style={{ backgroundColor: selectedId === it.id ? '#edf2fb' : 'transparent' }}
                  >
                    <span className="text-[12px] font-semibold flex-1" style={{ color: selectedId === it.id ? BRAND.primary : BRAND.textPrimary }}>
                      {it.name}
                    </span>
                    <span className="text-[11px]" style={{ color: BRAND.textSecondary }}>
                      {fmtRange(it)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button disabled={selectedIndex >= iterations.length - 1} onClick={() => move(1)} className="h-full px-2 flex cursor-pointer items-center hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40" style={{ color: BRAND.primaryLight, borderLeft: `1px solid ${BRAND.borderSubtle}` }}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex-1" />
      </div>

      {/* Metric strip */}
      <div className="flex items-stretch shrink-0" style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}`, height: 64 }}>
        <Metric label="Planned Velocity" value={`${velocityPct}%`} sub={`${metrics?.acceptedPoints ?? 0}/${metrics?.plannedVelocity ?? 0} pts`} bar={velocityPct} barColor={velocityPct >= 70 ? '#2a8c3f' : BRAND.primaryLight} />
        <Metric
          label="Iteration End"
          value={metrics?.daysLeft == null ? '—' : String(Math.max(metrics.daysLeft, 0))}
          sub={metrics?.daysLeft == null ? 'no end date' : metrics.daysLeft < 0 ? 'ended' : 'days left'}
          valueColor="#8a5808"
        />
        <Metric label="Accepted" value={`${metrics?.acceptedPercent ?? 0}%`} sub={`${metrics?.acceptedPoints ?? 0} pts`} valueColor="#1e6930" bar={metrics?.acceptedPercent ?? 0} barColor="#2a8c3f" />
        <Metric label="Defects" value={String(metrics?.defectCount ?? 0)} sub="active" valueColor={(metrics?.defectCount ?? 0) > 0 ? BRAND.danger : BRAND.textPrimary} />
        <Metric label="Tasks" value={String(metrics?.taskCount ?? 0)} sub="in iteration" last />
      </div>

      {/* List toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: BRAND.textMuted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter items..." className="pl-7 pr-3 py-1 text-[11px] rounded focus:outline-none" style={{ backgroundColor: BRAND.surfaceSubtle, border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary, width: 200 }} />
        </div>
        <div className="flex-1" />
        {canCreate && (
          <button onClick={() => setShowAdd(true)} className="flex cursor-pointer items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-white rounded transition-opacity hover:opacity-90" style={{ backgroundColor: BRAND.primary }}>
            <Plus size={12} /> Add Item
          </button>
        )}
      </div>

      {/* Work item list */}
      <div className="flex flex-col flex-1 overflow-auto" style={{ backgroundColor: BRAND.surface }}>
        <div className="sticky top-0 z-10 flex items-center h-8 px-3 select-none text-[11px] font-semibold" style={{ backgroundColor: BRAND.surfaceHover, borderBottom: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textMuted }}>
          <div className="w-5 shrink-0" />{/* Selection */}
          <div className="w-16 shrink-0">ID</div>
          <div className="w-16 shrink-0">Type</div>
          <div className="flex-1 min-w-[180px]">Name</div>
          <div className="w-32 shrink-0">Schedule State</div>
          <div className="w-36 shrink-0">Iteration</div>
          <div className="w-10 shrink-0 text-center">Blk</div>
          <div className="w-14 shrink-0 text-right">Plan Est</div>
          <div className="w-14 shrink-0 text-right">Task Est</div>
          <div className="w-12 shrink-0 text-right">To Do</div>
          <div className="w-24 shrink-0">Owner</div>
        </div>

        {isLoading && (
          <div className="h-40 flex items-center justify-center text-[12px]" style={{ color: BRAND.textMuted }}>
            Loading…
          </div>
        )}

        {!isLoading &&
          (status?.items ?? []).map((item) => (
            <StatusRow key={item.id} item={item} iterations={iterations} memberMap={memberMap} selectedIterationId={selectedId!} canEdit={canEdit} onOpen={() => navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })} />
          ))}

        {!isLoading && (status?.items?.length ?? 0) === 0 && (
          <div className="h-40 flex items-center justify-center text-[12px]" style={{ color: BRAND.textMuted }}>
            No items assigned to this iteration
          </div>
        )}
      </div>

      {showAdd && selected && (
        <AddItemModal iteration={selected} onClose={() => setShowAdd(false)} onCreated={() => setShowAdd(false)} />
      )}
    </div>
  )
}

// ── Metric card ─────────────────────────────────────────────────────────────

function Metric({
  label,
  value,
  sub,
  valueColor = BRAND.textPrimary,
  bar,
  barColor,
  last,
}: {
  label: string
  value: string
  sub: string
  valueColor?: string
  bar?: number
  barColor?: string
  last?: boolean
}) {
  return (
    <div className="flex flex-[1] flex-col justify-center px-5 gap-1 min-w-0" style={{ borderLeft: last || label === 'Planned Velocity' ? undefined : `1px solid ${BRAND.borderSubtle}` }}>
      <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: BRAND.textMuted }}>
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[20px] font-semibold leading-none" style={{ color: valueColor }}>
          {value}
        </span>
        <span className="text-[10px]" style={{ color: BRAND.textSecondary }}>
          {sub}
        </span>
      </div>
      {bar !== undefined && (
        <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#e4e8ed' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(bar, 100)}%`, backgroundColor: barColor }} />
        </div>
      )}
    </div>
  )
}

// ── Editable row ────────────────────────────────────────────────────────────

function StatusRow({
  item,
  iterations,
  memberMap,
  selectedIterationId,
  canEdit,
  onOpen,
}: {
  item: IterationStatusItem
  iterations: Iteration[]
  memberMap: Map<string, import('@/features/teams/api').ProjectMember>
  selectedIterationId: string
  canEdit: boolean
  onOpen: () => void
}) {
  const update = useUpdateWorkItem(item.id)
  const member = item.assigneeId ? memberMap.get(item.assigneeId) : undefined
  const ownerName = member?.displayName ?? member?.email ?? null

  return (
    <div className="flex items-center h-8 px-3 text-[11px]" style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}>
      {/* Selection */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        <input type="checkbox" className="rounded" style={{ accentColor: BRAND.primary }} />
      </div>
      <button className="w-16 shrink-0 cursor-pointer text-left font-mono truncate hover:underline" style={{ color: BRAND.primaryLight }} onClick={onOpen}>
        {item.itemKey}
      </button>
      <div className="w-16 shrink-0 capitalize" style={{ color: BRAND.textSecondary }}>
        {item.type}
      </div>
      <button className="flex-1 min-w-[180px] cursor-pointer text-left truncate pr-2 hover:underline" style={{ color: BRAND.textPrimary }} onClick={onOpen}>
        {item.title}
      </button>
      <div className="w-32 shrink-0">
        {canEdit ? (
          <select
            value={item.scheduleState}
            onChange={(e) => update.mutate({ scheduleState: e.target.value as ScheduleState })}
            className="text-[11px] px-1 py-0.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
          >
            {SCHEDULE_STATE_VALUES.map((s) => (
              <option key={s} value={s}>
                {SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
              </option>
            ))}
          </select>
        ) : (
          <ScheduleStateBadge state={item.scheduleState} />
        )}
      </div>
      <div className="w-36 shrink-0 pr-2">
        {canEdit ? (
          <select
            value={item.iterationId ?? ''}
            onChange={(e) => update.mutate({ iterationId: e.target.value || null })}
            className="w-full text-[11px] px-1 py-0.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
          >
            <option value="">Unscheduled</option>
            {iterations.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: BRAND.textSecondary }}>
            {iterations.find((i) => i.id === item.iterationId)?.name ?? '—'}
          </span>
        )}
      </div>
      {/* Blocked */}
      <div className="w-10 shrink-0 text-center">
        {item.isBlocked && (
          <span className="text-[10px] font-semibold px-1 py-px rounded" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
            B
          </span>
        )}
      </div>
      <div className="w-14 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {item.planEstimate ?? ''}
      </div>
      <div className="w-14 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {item.taskEstimate || ''}
      </div>
      <div className="w-12 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {item.toDo || ''}
      </div>
      {/* Owner */}
      <div className="w-24 shrink-0 truncate text-[11px]" style={{ color: BRAND.textSecondary }}>
        {ownerName ?? <span style={{ color: BRAND.textMuted }}>Unassigned</span>}
      </div>
      {/* selectedIterationId kept for future "leaves list on reassign" refetch semantics */}
      <span hidden>{selectedIterationId}</span>
    </div>
  )
}

// ── Add Item modal ──────────────────────────────────────────────────────────

function AddItemModal({
  iteration,
  onClose,
  onCreated,
}: {
  iteration: Iteration
  onClose: () => void
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateIterationItem(iteration.id)
  const [type, setType] = useState<'story' | 'defect'>('story')
  const [title, setTitle] = useState('')
  const [planEstimate, setPlanEstimate] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(openDetail = false) {
    setError(null)
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    try {
      const result = await create.mutateAsync({
        type,
        title: title.trim(),
        planEstimate: planEstimate === '' ? undefined : Number(planEstimate),
      })
      if (openDetail) {
        void navigate({ to: '/item/$itemKey', params: { itemKey: result.itemKey } })
      } else {
        onCreated()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create item')
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title="Add Item to Iteration"
      subtitle={`${iteration.name} · ${fmtRange(iteration)}`}
      width={460}
    >
      <ModalBody className="space-y-4">
        {/* Type toggle */}
        <FormField label="Type">
          <div className="flex gap-2">
            {(['story', 'defect'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setType(o)}
                className="flex-1 py-1.5 text-[11px] font-semibold rounded-sm capitalize transition-colors"
                style={{
                  backgroundColor: type === o ? '#eef3fb' : 'transparent',
                  color: type === o ? BRAND.primary : BRAND.textSecondary,
                  border: `1px solid ${type === o ? '#bdd0ef' : BRAND.borderSubtle}`,
                }}
              >
                {o}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Title" required error={error ?? undefined}>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a concise work item title..."
          />
        </FormField>

        <FormField label="Plan Estimate">
          <Input
            type="number"
            min={0}
            value={planEstimate}
            onChange={(e) => setPlanEstimate(e.target.value)}
            placeholder="0"
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[#f0f2f5]"
          style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => submit(true)}
          className="rounded px-4 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ border: '1px solid #9fb5d5', color: BRAND.primary, backgroundColor: '#f5f8fc' }}
        >
          Create with details
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => submit(false)}
          className="flex items-center gap-1.5 rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.primary }}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          Create Item
        </button>
      </ModalFooter>
    </AppModal>
  )
}
