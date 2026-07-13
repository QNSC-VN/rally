/**
 * Quality / Defect Tracking — P3.4
 *
 * Shows defect metrics strip + filterable defect table for the active project.
 * 12-column SRS layout: Rank, ID, Name, User Story, Severity, Priority,
 * State, Flow State, Fixed In Build, Iteration, Submitted By, Owner
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Search, PackageOpen, Plus } from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
import { BRAND } from '@/shared/config/brand'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { InlineCellSelect } from '@/shared/ui/native-select'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useDefects, useCreateDefect, qualityKeys, type DefectSeverity, type DefectRow } from '@/features/quality/api'
import { useProjectMembers } from '@/features/teams/api'
import { useReleases } from '@/features/releases/api'
import { useUpdateWorkItem } from '@/features/work-items/api'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { useQueryClient } from '@tanstack/react-query'
import { useColumnLayout, type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { ResizeHandle } from '@/shared/ui/resize-handle'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'

// ── Constants ──────────────────────────────────────────────────────────────

/** DB key → SRS display label mapping for severity */
const SEVERITY_STYLE: Record<DefectSeverity, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', label: 'Critical' },
  high: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa', label: 'Major Problem' },
  medium: { bg: '#fefce8', text: '#854d0e', border: '#fef08a', label: 'Minor Problem' },
  low: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1', label: 'Trivial' },
  none: { bg: '#f1f5f9', text: '#8c94a6', border: '#e2e6eb', label: 'None' },
}

const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'Major Problem' },
  { value: 'medium', label: 'Minor Problem' },
  { value: 'low', label: 'Trivial' },
  { value: 'none', label: 'None' },
]

/** Flow State (schedule state) — SRS labels */
const FLOW_STATE_LABEL: Record<string, string> = {
  idea: 'Idea',
  defined: 'Defined',
  in_progress: 'In-Progress',
  completed: 'Completed',
  accepted: 'Accepted',
  released: 'Released',
}

const FLOW_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'defined', label: 'Defined' },
  { value: 'in_progress', label: 'In-Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'released', label: 'Released' },
]

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

const DEFECT_STATE_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  submitted: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', label: 'Submitted' },
  open: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa', label: 'Open' },
  fixed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', label: 'Fixed' },
  closed: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1', label: 'Closed' },
  closed_declined: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', label: 'Closed Declined' },
}

const DEFECT_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'open', label: 'Open' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'closed', label: 'Closed' },
  { value: 'closed_declined', label: 'Closed Declined' },
]

function DefectStateInlineCell({
  defect,
  canEdit,
}: {
  defect: DefectRow
  canEdit: boolean
  projectId: string
}) {
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)
  const currentVal = defect.defectState ?? 'submitted'
  const style = DEFECT_STATE_STYLE[currentVal] ?? DEFECT_STATE_STYLE.submitted

  function handleChange(val: string) {
    if (val === currentVal) return
    update.mutate(
      { defectState: val } as never,
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: qualityKeys.all })
          toast.success('Defect state updated')
        },
        onError: () => {
          toast.error('Failed to update defect state')
        },
      },
    )
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {canEdit ? (
        <InlineCellSelect
          value={currentVal}
          displayValue={style.label}
          onChange={(e) => handleChange(e.target.value)}
          disabled={update.isPending}
        >
          {DEFECT_STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </InlineCellSelect>
      ) : (
        <span
          className="inline-flex items-center px-1.5 py-px text-[10px] font-medium rounded-sm"
          style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
        >
          {style.label}
        </span>
      )}
    </div>
  )
}

/** Fixed In Build inline editable cell */
function FixedInBuildCell({
  defect,
  canEdit,
}: {
  defect: DefectRow
  canEdit: boolean
  projectId: string
}) {
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  function handleCommit(value: string) {
    const trimmed = value.trim()
    if (trimmed === (defect.fixedInBuild ?? '')) return
    update.mutate(
      { fixedInBuild: trimmed || null } as never,
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: qualityKeys.all })
          toast.success('Fixed In Build updated')
        },
        onError: () => {
          toast.error('Failed to update')
        },
      },
    )
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <InlineEditableCell
        value={defect.fixedInBuild ?? ''}
        canEdit={canEdit}
        onCommit={handleCommit}
        trigger="dblclick"
        displayValue={defect.fixedInBuild ?? '—'}
        className="text-[10px] truncate hover:underline"
        style={{ color: '#5c6478' }}
        inputClassName="text-[10px] px-1 py-0.5 rounded focus:outline-none"
        inputStyle={{
          border: `1px solid ${BRAND.borderInput}`,
          backgroundColor: 'white',
          color: BRAND.textPrimary,
        }}
        ariaLabel="Fixed In Build"
        title={defect.fixedInBuild ?? ''}
      />
    </div>
  )
}


type QualityColKey = 'rank' | 'id' | 'name' | 'userStory' | 'severity' | 'priority' | 'state' | 'flowState' | 'fixedInBuild' | 'iteration' | 'submittedBy' | 'owner'

const QUALITY_COLUMNS: ColumnDef<QualityColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 40, locked: true },
  { key: 'id', label: 'ID', defaultWidth: 64, locked: true },
  { key: 'name', label: 'Name', defaultWidth: 200, minWidth: 120, locked: true },
  { key: 'userStory', label: 'User Story', defaultWidth: 140, minWidth: 80 },
  { key: 'severity', label: 'Severity', defaultWidth: 100, minWidth: 70 },
  { key: 'priority', label: 'Priority', defaultWidth: 80, minWidth: 60 },
  { key: 'state', label: 'State', defaultWidth: 100, minWidth: 70 },
  { key: 'flowState', label: 'Flow State', defaultWidth: 90, minWidth: 70 },
  { key: 'fixedInBuild', label: 'Fixed In Build', defaultWidth: 100, minWidth: 70 },
  { key: 'iteration', label: 'Iteration', defaultWidth: 100, minWidth: 70 },
  { key: 'submittedBy', label: 'Submitted By', defaultWidth: 100, minWidth: 70 },
  { key: 'owner', label: 'Owner', defaultWidth: 100, minWidth: 70 },
]

// ── Metric card ────────────────────────────────────────────────────────────

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col justify-center px-5 gap-0.5" style={{ borderLeft: `1px solid ${BRAND.border}` }}>
      <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: '#8c94a6' }}>
        {label}
      </span>
      <span className="text-[17px] font-semibold leading-none" style={{ color }}>
        {value}
      </span>
    </div>
  )
}

// ── Small filter select ───────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-[11px] rounded px-1.5 py-1 bg-white focus:outline-none"
      style={{ border: `1px solid ${BRAND.border}`, color: '#5c6478' }}
      aria-label={label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Inline cell handlers ───────────────────────────────────────────────────

function DefectInlineCell({
  defect,
  field,
  options,
  currentValue,
  displayValue,
  canEdit,
}: {
  defect: DefectRow
  field: 'severity' | 'priority' | 'scheduleState'
  options: { value: string; label: string }[]
  currentValue: string
  displayValue: string
  canEdit: boolean
  projectId: string
}) {
  const qc = useQueryClient()
  const update = useUpdateWorkItem(defect.id)

  function handleChange(val: string) {
    if (val === currentValue) return
    update.mutate(
      { [field]: val || undefined } as never,
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: qualityKeys.all })
        },
        onError: () => {
          toast.error('Failed to update')
        },
      },
    )
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <InlineCellSelect
        value={currentValue}
        displayValue={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        disabled={!canEdit || update.isPending}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </InlineCellSelect>
    </div>
  )
}

// ── Log Defect modal ───────────────────────────────────────────────────────

function LogDefectModal({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('')
  const [priority, setPriority] = useState('normal')
  const [environment, setEnvironment] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [releaseId, setReleaseId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: members } = useProjectMembers(projectId)
  const { data: releases } = useReleases(projectId)
  const createDefect = useCreateDefect()

  async function handleSubmit() {
    setError(null)
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    try {
      await createDefect.mutateAsync({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        severity: severity || undefined,
        priority,
        foundInEnvironment: environment || undefined,
        rootCause: rootCause || undefined,
        assigneeId: assigneeId || undefined,
        releaseId: releaseId || undefined,
      })
      toast.success(`Defect "${title.trim()}" logged`)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to log defect'
      setError(msg)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title="Log Defect" width={480}>
      <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}>
        <ModalBody className="space-y-4">
          <FormField label="Title" required error={error ?? undefined}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the defect"
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behavior..."
              rows={3}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Severity">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: '#1a2234' }}
              >
                <option value="">—</option>
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: '#1a2234' }}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Found In">
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: '#1a2234' }}
              >
                <option value="">—</option>
                {(['development', 'staging', 'production', 'testing'] as const).map((e) => (
                  <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Root Cause">
              <select
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: '#1a2234' }}
              >
                <option value="">—</option>
                {(['requirements', 'design', 'code', 'test', 'integration', 'other'] as const).map((r) => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Assignee">
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: '#1a2234' }}
              >
                <option value="">Unassigned</option>
                {(members ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Release">
              <select
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: BRAND.border, color: '#1a2234' }}
              >
                <option value="">—</option>
                {(releases ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </FormField>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-md cursor-pointer"
            style={{ border: `1px solid ${BRAND.border}`, color: '#5c6478' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createDefect.isPending || !title.trim()}
            className="px-4 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-50 cursor-pointer"
            style={{ backgroundColor: BRAND.primary }}
          >
            {createDefect.isPending ? 'Logging...' : 'Log Defect'}
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Quality page ───────────────────────────────────────────────────────────

export function QualityPage() {
  const navigate = useNavigate()
  const { project } = useAppContext()
  const canManage = useAuthStore((s) => s.hasPermission('quality:edit'))
  const { startResize, styleFor } = useColumnLayout(QUALITY_COLUMNS, STORAGE_KEYS.QUALITY_COLUMNS)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [envFilter, setEnvFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [releaseFilter, setReleaseFilter] = useState('all')
  const [rootCauseFilter, setRootCauseFilter] = useState('all')
  const [resolutionFilter, setResolutionFilter] = useState('all')
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
  })

  const defects = data?.data ?? []
  const metrics = data?.metrics ?? { openDefects: 0, critical: 0, inProgress: 0, verifiedAccepted: 0, reopened: 0, blockers: 0 }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 p-8">
        <AlertTriangle size={32} style={{ color: BRAND.danger }} />
        <p className="text-sm" style={{ color: '#5c6478' }}>
          {error instanceof Error ? error.message : 'Failed to load defects'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Metrics strip */}
      <div className="flex items-stretch bg-white shrink-0" style={{ borderBottom: `1px solid ${BRAND.border}`, height: 52 }}>
        <MetricCard label="Open Defects" value={metrics.openDefects} color="#8a5808" />
        <MetricCard label="Critical" value={metrics.critical} color="#b91c1c" />
        <MetricCard label="In Progress" value={metrics.inProgress} color="#7e22ce" />
        <MetricCard label="Verified / Accepted" value={metrics.verifiedAccepted} color="#1e6930" />
        <MetricCard label="Reopened" value={metrics.reopened} color="#1a2234" />
        <MetricCard label="Blockers" value={metrics.blockers} color={metrics.blockers > 0 ? '#b91c1c' : '#1a2234'} />
        <div className="flex-1" style={{ borderLeft: `1px solid ${BRAND.border}` }} />
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-1.5 px-4 py-1.5 bg-white shrink-0 flex-wrap"
        style={{ borderBottom: `1px solid ${BRAND.border}` }}
      >
        <h2 className="text-[13px] font-semibold mr-1" style={{ color: '#1a2234' }}>
          Defects
        </h2>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#8c94a6' }} />
          <input
            type="text"
            placeholder="Search defects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1 text-[11px] rounded focus:outline-none"
            style={{ backgroundColor: '#f4f6f9', border: `1px solid ${BRAND.border}`, color: '#1a2234', width: 140 }}
          />
        </div>

        <FilterSelect label="Severity" value={severityFilter} onChange={setSeverityFilter} options={[
          { value: 'all', label: 'All Severity' },
          ...SEVERITY_OPTIONS,
        ]} />

        <FilterSelect label="Environment" value={envFilter} onChange={setEnvFilter} options={[
          { value: 'all', label: 'All Env' },
          { value: 'development', label: 'Development' },
          { value: 'staging', label: 'Staging' },
          { value: 'production', label: 'Production' },
          { value: 'testing', label: 'Testing' },
        ]} />

        <FilterSelect label="Priority" value={priorityFilter} onChange={setPriorityFilter} options={[
          { value: 'all', label: 'All Priority' },
          ...PRIORITY_OPTIONS,
        ]} />

        <FilterSelect label="Flow State" value={stateFilter} onChange={setStateFilter} options={[
          { value: 'all', label: 'All Flow States' },
          ...FLOW_STATE_OPTIONS,
        ]} />

        <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter} options={[
          { value: 'all', label: 'All Owners' },
          ...(members ?? []).map((m) => ({ value: m.userId, label: m.displayName ?? m.email ?? m.userId })),
        ]} />

        <FilterSelect label="Release" value={releaseFilter} onChange={setReleaseFilter} options={[
          { value: 'all', label: 'All Releases' },
          ...(releases ?? []).map((r) => ({ value: r.id, label: r.name })),
        ]} />

        <FilterSelect label="Root Cause" value={rootCauseFilter} onChange={setRootCauseFilter} options={[
          { value: 'all', label: 'All Root Causes' },
          { value: 'requirements', label: 'Requirements' },
          { value: 'design', label: 'Design' },
          { value: 'code', label: 'Code' },
          { value: 'test', label: 'Test' },
          { value: 'integration', label: 'Integration' },
          { value: 'other', label: 'Other' },
        ]} />

        <FilterSelect label="Resolution" value={resolutionFilter} onChange={setResolutionFilter} options={[
          { value: 'all', label: 'All Resolutions' },
          { value: 'fixed', label: 'Fixed' },
          { value: 'wont_fix', label: "Won't Fix" },
          { value: 'duplicate', label: 'Duplicate' },
          { value: 'cannot_reproduce', label: 'Cannot Reproduce' },
          { value: 'deferred', label: 'Deferred' },
          { value: 'by_design', label: 'By Design' },
        ]} />

        <div className="flex-1" />

        {canManage && (
          <button
            onClick={() => setShowLogDefect(true)}
            className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-white rounded ml-1 hover:brightness-95 cursor-pointer"
            style={{ backgroundColor: '#1d3f73' }}
          >
            <Plus size={12} />
            Log Defect
          </button>
        )}
      </div>

      {/* Defect table */}
      <div className="flex flex-1 overflow-hidden bg-white">
        {isLoading ? (
          <SkeletonList rows={8} />
        ) : defects.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8">
            <PackageOpen size={40} style={{ color: '#c4cad4' }} />
            <p className="text-sm" style={{ color: '#8c94a6' }}>
              {search || severityFilter !== 'all' || envFilter !== 'all' || priorityFilter !== 'all' || stateFilter !== 'all'
                ? 'No defects match your filters'
                : 'No defects logged yet'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header */}
            <div
              className="flex items-center h-8 px-3 shrink-0 select-none overflow-x-auto"
              style={{ backgroundColor: '#f7f8fa', borderBottom: `1px solid ${BRAND.border}`, minWidth: 'max-content' }}
            >
              {QUALITY_COLUMNS.map((col) => (
                <div
                  key={col.key}
                  className="relative group flex items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap"
                  style={{ ...styleFor(col.key, { flexShrink: 0 }), color: '#8c94a6' }}
                >
                  <span>{col.label}</span>
                  <ResizeHandle onMouseDown={(e) => startResize(col.key, e)} ariaLabel={`Resize ${col.label} column`} />
                </div>
              ))}
            </div>
            {/* Rows */}
            <div className="flex-1 overflow-auto">
              {defects.map((d, idx) => {
                const sevStyle = d.severity && d.severity !== 'none' ? SEVERITY_STYLE[d.severity] : null
                const flowLabel = FLOW_STATE_LABEL[d.scheduleState] ?? d.scheduleState
                const userStory = d.parentKey
                  ? `${d.parentKey}: ${d.parentTitle ?? ''}`
                  : d.parentTitle ?? ''

                return (
                  <div
                    key={d.id}
                    className="flex items-center h-8 px-3 cursor-pointer"
                    style={{ borderBottom: '1px solid #edf0f4', minWidth: 'max-content' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f7f8fa')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => navigate({ to: '/item/$itemKey', params: { itemKey: d.itemKey } })}
                  >
                    {/* Rank */}
                    <div className="shrink-0 text-[10px] text-center px-2" style={{ ...styleFor('rank'), color: '#8c94a6' }}>
                      {idx + 1}
                    </div>
                    {/* ID */}
                    <div className="flex shrink-0 items-center gap-1 px-2" style={styleFor('id')}>
                      <TypeBadge type={d.type} />
                      <span className="font-mono text-[10px]" style={{ color: '#5c6478' }}>{d.itemKey}</span>
                    </div>
                    {/* Name */}
                    <div className="shrink-0 px-2 min-w-0" style={styleFor('name')}>
                      <span className="block truncate text-[12px] font-medium" style={{ color: '#1a2234' }}>
                        {d.title}
                      </span>
                    </div>
                    {/* User Story */}
                    <div className="shrink-0 text-[10px] truncate px-2" style={{ ...styleFor('userStory'), color: '#5c6478' }} title={userStory}>
                      {userStory || '—'}
                    </div>
                    {/* Severity (inline editable) */}
                    <div className="shrink-0 px-2" style={styleFor('severity')} onClick={(e) => e.stopPropagation()}>
                      {sevStyle ? (
                        <DefectInlineCell
                          defect={d}
                          field="severity"
                          options={SEVERITY_OPTIONS}
                          currentValue={d.severity!}
                          displayValue={sevStyle.label}
                          canEdit={canManage}
                          projectId={project?.projectId ?? ''}
                        />
                      ) : (
                        <span className="text-[10px]" style={{ color: '#c4cad4' }}>—</span>
                      )}
                    </div>
                    {/* Priority (inline editable) */}
                    <div className="shrink-0 px-2" style={styleFor('priority')} onClick={(e) => e.stopPropagation()}>
                      <DefectInlineCell
                        defect={d}
                        field="priority"
                        options={PRIORITY_OPTIONS}
                        currentValue={d.priority}
                        displayValue={d.priority === 'none' ? '—' : d.priority.charAt(0).toUpperCase() + d.priority.slice(1)}
                        canEdit={canManage}
                        projectId={project?.projectId ?? ''}
                      />
                    </div>
                    {/* State (defect-specific, inline editable) */}
                    <div className="shrink-0 px-2" style={styleFor('state')}>
                      <DefectStateInlineCell
                        defect={d}
                        canEdit={canManage}
                        projectId={project?.projectId ?? ''}
                      />
                    </div>
                    {/* Flow State (inline editable) */}
                    <div className="shrink-0 px-2" style={styleFor('flowState')} onClick={(e) => e.stopPropagation()}>
                      <DefectInlineCell
                        defect={d}
                        field="scheduleState"
                        options={FLOW_STATE_OPTIONS}
                        currentValue={d.scheduleState}
                        displayValue={flowLabel}
                        canEdit={canManage}
                        projectId={project?.projectId ?? ''}
                      />
                    </div>
                    {/* Fixed In Build */}
                    <div className="shrink-0 px-2" style={styleFor('fixedInBuild')}>
                      <FixedInBuildCell
                        defect={d}
                        canEdit={canManage}
                        projectId={project?.projectId ?? ''}
                      />
                    </div>
                    {/* Iteration */}
                    <div className="shrink-0 text-[10px] truncate px-2" style={{ ...styleFor('iteration'), color: '#5c6478' }} title={d.iterationName ?? ''}>
                      {d.iterationName ?? '—'}
                    </div>
                    {/* Submitted By */}
                    <div className="shrink-0 text-[10px] truncate px-2" style={{ ...styleFor('submittedBy'), color: '#5c6478' }} title={d.createdByName ?? ''}>
                      {d.createdByName ?? '—'}
                    </div>
                    {/* Owner */}
                    <div className="shrink-0 text-[10px] truncate px-2" style={{ ...styleFor('owner'), color: '#5c6478' }} title={d.assigneeName ?? ''}>
                      {d.assigneeName ?? '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
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