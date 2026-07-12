/**
 * Milestone Detail Page — P3.3
 *
 * Two-panel layout with Details / Artifacts tabs matching the Release detail page pattern.
 * Details tab: left panel (description, notes) + right sidebar (projects, teams, releases, owner, dates, status).
 * Artifacts tab: backlog-style table of assigned US/DE work items with search + pagination.
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  Search,
  Users,
  FolderKanban,
  Layers,
  CalendarDays,
} from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { InlineSelect } from '@/shared/ui/native-select'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SkeletonList } from '@/shared/ui/skeleton'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useMilestone,
  useUpdateMilestone,
  useMilestoneProjects,
  useSetMilestoneProjects,
  useMilestoneTeams,
  useSetMilestoneTeams,
  useMilestoneReleases,
  useSetMilestoneReleases,
  useMilestoneArtifacts,
  type MilestoneStatus,
  type ArtifactItem,
} from '@/features/milestones/api'
import { useReleases } from '@/features/releases/api'
import { useWorkspaceTeams } from '@/features/teams/api'
import { useProjectMembers } from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'
import { TypeBadge, ScheduleStateBadge, PriorityBadge } from '@/entities/work-item/ui/badges'

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<MilestoneStatus, { bg: string; text: string; border: string; label: string }> = {
  planned: { bg: '#eef3fb', text: '#475569', border: '#cbd5e1', label: 'Planned' },
  at_risk: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa', label: 'At Risk' },
  met: { bg: '#eaf5ed', text: '#1e6930', border: '#b9dec2', label: 'Met' },
  missed: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', label: 'Missed' },
  cancelled: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1', label: 'Cancelled' },
  completed: { bg: '#eef6f0', text: '#1e6930', border: '#a8d5b3', label: 'Completed' },
}

const MILESTONE_STATUSES: MilestoneStatus[] = ['planned', 'at_risk', 'met', 'missed', 'cancelled', 'completed']

// ── Searchable Selection Modal (reusable) ───────────────────────────────────────

interface SelectionItem {
  id: string
  name: string
}

function SelectionModal({
  open,
  onClose,
  title,
  items,
  selectedIds,
  onSave,
}: {
  open: boolean
  onClose: () => void
  title: string
  items: SelectionItem[]
  selectedIds: string[]
  onSave: (ids: string[]) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [local, setLocal] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Sync local state when modal opens
  useEffect(() => {
    if (open) {
      setLocal([...selectedIds])
      setSearch('')
    }
  }, [open, selectedIds])

  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((it) => it.name.toLowerCase().includes(q))
  }, [items, search])

  function toggle(id: string) {
    setLocal((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAll() {
    if (filtered.every((it) => local.includes(it.id))) {
      setLocal((prev) => prev.filter((id) => !filtered.some((f) => f.id === id)))
    } else {
      setLocal((prev) => {
        const next = new Set(prev)
        filtered.forEach((it) => next.add(it.id))
        return [...next]
      })
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(local)
      toast.success(`${title} updated`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to update ${title.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((it) => local.includes(it.id))

  return (
    <AppModal open={open} onClose={onClose} title={title} width={440}>
      {/* Search bar above ModalBody */}
      <div className="px-5 pt-3 pb-1">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#8c94a6' }} />
          <input
            type="text"
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md focus:outline-none focus:ring-1"
            style={{
              backgroundColor: '#f4f6f9',
              border: `1px solid ${BRAND.border}`,
              color: '#1a2234',
            }}
            autoFocus
          />
        </div>
      </div>
      <ModalBody className="space-y-1" style={{ maxHeight: 320 }}>
        {/* Select-all row */}
        <label
          className="flex items-center gap-2 px-1 py-1.5 text-[11px] font-semibold cursor-pointer select-none rounded hover:bg-gray-50"
          style={{ color: BRAND.textSecondary }}
        >
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleAll}
            className="h-3.5 w-3.5 rounded"
            style={{ accentColor: BRAND.primary }}
          />
          {allFilteredSelected ? 'Deselect All' : 'Select All'} ({filtered.length})
        </label>
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-xs py-4 text-center" style={{ color: BRAND.textMuted }}>
              No items found
            </p>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                className="flex items-center gap-2 px-1 py-1.5 text-xs cursor-pointer select-none rounded hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={local.includes(item.id)}
                  onChange={() => toggle(item.id)}
                  className="h-3.5 w-3.5 rounded"
                  style={{ accentColor: BRAND.primary }}
                />
                <span className="truncate" style={{ color: BRAND.textPrimary }}>
                  {item.name}
                </span>
              </label>
            ))
          )}
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
          type="button"
          onClick={() => { void handleSave() }}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-50 cursor-pointer"
          style={{ backgroundColor: BRAND.primary }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          Save
        </button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Relation summary button (right sidebar) ────────────────────────────────────

function RelationButton({
  icon: Icon,
  label,
  count,
  onClick,
  canManage,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  label: string
  count: number
  onClick: () => void
  canManage: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canManage}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-80 text-left"
      style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
    >
      <Icon size={14} style={{ color: BRAND.textMuted }} />
      <span className="flex-1 font-medium">{label}</span>
      <span
        className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
        style={{ backgroundColor: BRAND.primaryLighter, color: BRAND.primary }}
      >
        {count}
      </span>
    </button>
  )
}

// ── Owner cell (avatar + name) ─────────────────────────────────────────────────

function OwnerCell({ name }: { name?: string | null }) {
  if (!name)
    return <span className="text-[10px]" style={{ color: '#a0a7b5' }}>—</span>
  const initials = name.split(' ').slice(0, 2).map((n) => n[0]?.toUpperCase()).join('')
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
        style={{ backgroundColor: '#e5ebf4', color: '#1d3f73' }}
      >
        {initials}
      </span>
      <span className="truncate text-[10px]" style={{ color: '#5c6478' }}>{name}</span>
    </div>
  )
}

// ── Artifacts table row ────────────────────────────────────────────────────────

function ArtifactRow({ item, index, onOpen }: { item: ArtifactItem; index: number; onOpen: () => void }) {
  return (
    <tr
      className="cursor-pointer transition-colors duration-75"
      style={{ borderBottom: '1px solid #edf0f4' }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f7f8fa')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      onClick={onOpen}
    >
      {/* Rank */}
      <td className="h-8 px-3 text-center font-mono text-[10px] tabular-nums" style={{ color: '#8c94a6' }}>
        {index + 1}
      </td>
      {/* ID */}
      <td className="h-8 px-3 font-mono text-[10px] underline-offset-2 hover:underline" style={{ color: BRAND.primaryLight }}>
        {item.itemKey}
      </td>
      {/* Name */}
      <td className="h-8 px-3">
        <span className="text-xs font-medium truncate block max-w-[300px]" style={{ color: BRAND.textPrimary }}>
          {item.title}
        </span>
      </td>
      {/* Type */}
      <td className="h-8 px-3">
        <TypeBadge type={item.type} />
      </td>
      {/* Schedule State */}
      <td className="h-8 px-3">
        <ScheduleStateBadge state={item.scheduleState} />
      </td>
      {/* Priority */}
      <td className="h-8 px-3">
        <PriorityBadge priority={item.priority} />
      </td>
      {/* Owner */}
      <td className="h-8 px-3">
        <OwnerCell name={item.assigneeName} />
      </td>
      {/* Estimate */}
      <td className="h-8 px-3 text-center font-mono text-[10px]" style={{ color: '#5c6478' }}>
        {item.storyPoints ?? '—'}
      </td>
    </tr>
  )
}

// ── Artifacts tab ──────────────────────────────────────────────────────────────

function ArtifactsTab({ milestoneId }: { milestoneId: string }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const currentPage = cursorHistory.length + 1

  const { data, isLoading } = useMilestoneArtifacts(milestoneId, {
    pageSize,
    search: search || undefined,
  })

  const items = useMemo(() => data?.data ?? [], [data])
  const pageInfo = data?.pageInfo

  // Reset pagination on search / pageSize change
  useEffect(() => {
    const id = setTimeout(() => {
      setCursor(undefined)
      setCursorHistory([])
    }, 0)
    return () => clearTimeout(id)
  }, [search, pageSize])

  function onPrevPage() {
    const prev = cursorHistory[cursorHistory.length - 2]
    setCursorHistory((h) => h.slice(0, -1))
    setCursor(prev)
  }

  function onNextPage() {
    if (!pageInfo?.hasNextPage || !pageInfo.nextCursor) return
    setCursorHistory((h) => [...h, cursor ?? ''])
    setCursor(pageInfo.nextCursor)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}`, backgroundColor: BRAND.surface }}
      >
        <div className="relative" style={{ width: 220 }}>
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#8c94a6' }} />
          <input
            type="text"
            placeholder="Search artifacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md focus:outline-none focus:ring-1"
            style={{
              backgroundColor: '#f4f6f9',
              border: `1px solid ${BRAND.border}`,
              color: '#1a2234',
            }}
          />
        </div>
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
          {pageInfo?.total != null ? `${pageInfo.total} items` : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: BRAND.surface }}>
        {isLoading ? (
          <SkeletonList rows={8} />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-8">
            <Layers size={32} style={{ color: '#c4cad4' }} />
            <p className="text-xs" style={{ color: BRAND.textMuted }}>
              {search ? 'No artifacts match your search' : 'No artifacts linked to this milestone'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr
                className="text-[9px] font-semibold uppercase tracking-wider select-none"
                style={{ backgroundColor: '#f7f8fa', borderBottom: `1px solid ${BRAND.border}` }}
              >
                <th className="h-7 px-3 font-medium text-center w-12" style={{ color: '#8c94a6' }}>#</th>
                <th className="h-7 px-3 font-medium w-20" style={{ color: '#8c94a6' }}>ID</th>
                <th className="h-7 px-3 font-medium" style={{ color: '#8c94a6' }}>Name</th>
                <th className="h-7 px-3 font-medium w-14" style={{ color: '#8c94a6' }}>Type</th>
                <th className="h-7 px-3 font-medium w-24" style={{ color: '#8c94a6' }}>Schedule State</th>
                <th className="h-7 px-3 font-medium w-16" style={{ color: '#8c94a6' }}>Priority</th>
                <th className="h-7 px-3 font-medium w-28" style={{ color: '#8c94a6' }}>Owner</th>
                <th className="h-7 px-3 font-medium text-center w-14" style={{ color: '#8c94a6' }}>Est.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <ArtifactRow
                  key={item.id}
                  item={item}
                  index={cursorHistory.length * pageSize + idx}
                  onOpen={() => navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {items.length > 0 && (
        <div
          className="flex h-9 shrink-0 items-center justify-between bg-white px-3"
          style={{ borderTop: '1px solid #e2e6eb' }}
        >
          <div className="flex items-center gap-2 text-[11px]" style={{ color: '#5c6478' }}>
            <span>Rows per page</span>
            <InlineSelect
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-auto"
            >
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </InlineSelect>
            <span style={{ color: '#8c94a6' }}>
              {pageInfo
                ? `${(currentPage - 1) * pageSize + 1}–${(currentPage - 1) * pageSize + items.length}${pageInfo.total ? ` of ${pageInfo.total}` : ''}`
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums" style={{ color: '#5c6478' }}>Page {currentPage}</span>
            <button
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={onPrevPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={!pageInfo?.hasNextPage}
              onClick={onNextPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type TabKey = 'details' | 'artifacts'

export function MilestoneDetailPage() {
  const { milestoneId } = useParams({ from: '/milestones/$milestoneId' })
  const navigate = useNavigate()
  const { project, workspace } = useAppContext()
  const projectId = project?.projectId ?? ''
  const workspaceId = workspace?.workspaceId ?? ''
  const canManage = useAuthStore((s) => s.hasPermission('milestone:manage'))

  const { data: milestone, isLoading, isError } = useMilestone(milestoneId)
  const update = useUpdateMilestone()

  // Relation data
  const { data: linkedProjects = [] } = useMilestoneProjects(milestoneId)
  const { data: linkedTeams = [] } = useMilestoneTeams(milestoneId)
  const { data: linkedReleases = [] } = useMilestoneReleases(milestoneId)

  // Available items for selection modals
  const { data: allProjects = [] } = useProjects(workspaceId || undefined)
  const { data: allTeams = [] } = useWorkspaceTeams(workspaceId || undefined)
  const { data: allReleases = [] } = useReleases(projectId || undefined)
  const { data: members = [] } = useProjectMembers(projectId || undefined)

  // Set mutations
  const setProjects = useSetMilestoneProjects()
  const setTeams = useSetMilestoneTeams()
  const setReleases = useSetMilestoneReleases()

  // Local state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<MilestoneStatus>('planned')
  const [ownerId, setOwnerId] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('details')
  const [saving, setSaving] = useState(false)

  // Selection modals
  const [showProjectsModal, setShowProjectsModal] = useState(false)
  const [showTeamsModal, setShowTeamsModal] = useState(false)
  const [showReleasesModal, setShowReleasesModal] = useState(false)

  useEffect(() => {
    if (milestone) {
      setName(milestone.name)
      setDescription(milestone.description ?? '')
      setNotes(milestone.notes ?? '')
      setStatus(milestone.status)
      setOwnerId(milestone.ownerId ?? '')
    }
  }, [milestone])

  async function handleFieldSave() {
    if (!milestone) return
    if (!name.trim()) {
      toast.error('Milestone name is required')
      return
    }
    setSaving(true)
    try {
      await update.mutateAsync({
        id: milestone.id,
        name: name.trim(),
        description: description.trim() || null,
        notes: notes.trim() || null,
        status,
        ownerId: ownerId || null,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(newStatus: MilestoneStatus) {
    if (!milestone) return
    setStatus(newStatus)
    try {
      await update.mutateAsync({ id: milestone.id, status: newStatus })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
      setStatus(milestone.status)
    }
  }

  async function handleOwnerChange(newOwnerId: string) {
    if (!milestone) return
    setOwnerId(newOwnerId)
    try {
      await update.mutateAsync({ id: milestone.id, ownerId: newOwnerId || null })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update owner')
      setOwnerId(milestone.ownerId ?? '')
    }
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ backgroundColor: BRAND.pageBg }}>
        <Loader2 className="animate-spin" size={24} style={{ color: BRAND.primary }} />
      </div>
    )
  }

  if (isError || !milestone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ backgroundColor: BRAND.pageBg }}>
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Milestone details could not be loaded.
        </p>
        <Link to="/milestones" className="text-[12px] font-semibold hover:underline" style={{ color: BRAND.primary }}>
          ← Back to Milestones
        </Link>
      </div>
    )
  }

  const s = STATUS_STYLE[milestone.status] ?? STATUS_STYLE.planned

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'artifacts', label: 'Artifacts' },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ backgroundColor: BRAND.pageBg }}>
      {/* Header bar */}
      <div
        className="flex h-12 shrink-0 items-center justify-between gap-4 px-4"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        <div className="flex items-center gap-2">
          <Link
            to="/milestones"
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-gray-100 transition-colors"
            style={{ color: BRAND.textSecondary }}
          >
            <ChevronLeft size={16} />
          </Link>
          <div className="flex items-center gap-3">
            {canManage ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleFieldSave}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFieldSave() }}
                className="text-[14px] font-semibold bg-transparent focus:outline-none focus:bg-white focus:ring-1 px-1 py-0.5 rounded border-0"
                style={{ color: BRAND.textPrimary, width: 320 }}
              />
            ) : (
              <h1 className="text-[14px] font-semibold" style={{ color: BRAND.textPrimary }}>
                {milestone.name}
              </h1>
            )}
            <span
              className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium"
              style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
            >
              {s.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saving && <Loader2 size={12} className="animate-spin" style={{ color: BRAND.primary }} />}
          {canManage && (
            <button
              onClick={handleFieldSave}
              disabled={update.isPending || saving}
              className="flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: BRAND.primary }}
            >
              {update.isPending || saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save Changes
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center gap-0 px-4 shrink-0"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="relative px-4 py-2.5 text-[12px] font-medium transition-colors"
            style={{
              color: activeTab === tab.key ? BRAND.primary : BRAND.textSecondary,
            }}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: BRAND.primary }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      {activeTab === 'artifacts' ? (
        <ArtifactsTab milestoneId={milestoneId} />
      ) : (
        /* Details tab — two panel layout */
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel: Description & Notes */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ backgroundColor: BRAND.surface }}>
            <div className="space-y-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: BRAND.textSecondary }}>
                Description
              </h2>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleFieldSave}
                disabled={!canManage}
                placeholder="Enter milestone description..."
                rows={6}
                className="w-full text-[12px] p-3 rounded-md border focus:outline-none focus:ring-1"
                style={{ borderColor: BRAND.border, backgroundColor: BRAND.surface, color: BRAND.textPrimary }}
              />
            </div>

            <div className="space-y-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: BRAND.textSecondary }}>
                Notes
              </h2>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={handleFieldSave}
                disabled={!canManage}
                placeholder="Add internal notes..."
                rows={10}
                className="w-full text-[12px] p-3 rounded-md border focus:outline-none focus:ring-1"
                style={{ borderColor: BRAND.border, backgroundColor: BRAND.surface, color: BRAND.textPrimary }}
              />
            </div>
          </div>

          {/* Right sidebar (320px, scrollable) */}
          <div
            className="w-80 shrink-0 overflow-y-auto border-l p-5 space-y-5"
            style={{ backgroundColor: BRAND.surface, borderColor: BRAND.border }}
          >
            <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: BRAND.textMuted }}>
              Metadata Details
            </h2>

            {/* Projects */}
            <RelationButton
              icon={FolderKanban}
              label="Projects"
              count={linkedProjects.length}
              onClick={() => setShowProjectsModal(true)}
              canManage={canManage}
            />

            {/* Teams */}
            <RelationButton
              icon={Users}
              label="Teams"
              count={linkedTeams.length}
              onClick={() => setShowTeamsModal(true)}
              canManage={canManage}
            />

            {/* Releases */}
            <RelationButton
              icon={Layers}
              label="Releases"
              count={linkedReleases.length}
              onClick={() => setShowReleasesModal(true)}
              canManage={canManage}
            />

            {/* Divider */}
            <div style={{ borderTop: `1px solid ${BRAND.borderSubtle}` }} />

            {/* Owner */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>Owner</label>
              {canManage ? (
                <select
                  value={ownerId}
                  onChange={(e) => { void handleOwnerChange(e.target.value) }}
                  className="w-full text-[11px] px-2 py-1 rounded bg-white focus:outline-none cursor-pointer"
                  style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName ?? m.email ?? m.userId}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-[12px] font-semibold py-1" style={{ color: BRAND.textPrimary }}>
                  {members.find((m) => m.userId === milestone.ownerId)?.displayName
                    ?? members.find((m) => m.userId === milestone.ownerId)?.email
                    ?? '—'}
                </div>
              )}
            </div>

            {/* Target Start Date (read-only, derived) */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                Target Start Date
              </label>
              <div className="flex items-center gap-1.5">
                <CalendarDays size={12} style={{ color: BRAND.textMuted }} />
                <span className="text-[12px] font-mono" style={{ color: BRAND.textPrimary }}>
                  {milestone.targetStartDate ?? '—'}
                </span>
              </div>
              <p className="text-[9px]" style={{ color: BRAND.textMuted }}>Derived from linked Releases</p>
            </div>

            {/* Target End Date (read-only, derived) */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                Target End Date
              </label>
              <div className="flex items-center gap-1.5">
                <CalendarDays size={12} style={{ color: BRAND.textMuted }} />
                <span className="text-[12px] font-mono" style={{ color: BRAND.textPrimary }}>
                  {milestone.targetEndDate ?? '—'}
                </span>
              </div>
              <p className="text-[9px]" style={{ color: BRAND.textMuted }}>Derived from linked Releases</p>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>Status</label>
              {canManage ? (
                <InlineSelect
                  value={status}
                  onChange={(e) => { void handleStatusChange(e.target.value as MilestoneStatus) }}
                  className="w-full text-[11px] px-2 py-1 rounded bg-white focus:outline-none"
                  style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
                >
                  {MILESTONE_STATUSES.map((st) => (
                    <option key={st} value={st}>{STATUS_STYLE[st].label}</option>
                  ))}
                </InlineSelect>
              ) : (
                <span
                  className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium"
                  style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
                >
                  {s.label}
                </span>
              )}
            </div>

            {/* Progress */}
            {milestone.progress && (
              <div
                className="p-3 rounded-md space-y-2"
                style={{ backgroundColor: '#f8fafc', border: `1px solid ${BRAND.borderSubtle}` }}
              >
                <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND.textSecondary }}>
                  Progress
                </h3>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
                    <span>Completion</span>
                    <span>{milestone.progress.progressPercent}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#e2e8f0' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${milestone.progress.progressPercent}%`,
                        backgroundColor: milestone.progress.progressPercent === 100 ? '#16a34a' : '#2563eb',
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]" style={{ color: BRAND.textMuted }}>
                  <div>
                    Items: <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
                      {milestone.progress.completedItems}/{milestone.progress.totalItems}
                    </span>
                  </div>
                  <div>
                    Points: <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
                      {milestone.progress.completedPoints}/{milestone.progress.totalPoints}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selection modals */}
      {showProjectsModal && (
        <SelectionModal
          open={showProjectsModal}
          onClose={() => setShowProjectsModal(false)}
          title="Projects"
          items={allProjects.map((p) => ({ id: p.id, name: p.name }))}
          selectedIds={linkedProjects.map((p) => p.id)}
          onSave={(ids) => setProjects.mutateAsync({ milestoneId, projectIds: ids })}
        />
      )}
      {showTeamsModal && (
        <SelectionModal
          open={showTeamsModal}
          onClose={() => setShowTeamsModal(false)}
          title="Teams"
          items={allTeams.map((t) => ({ id: t.id, name: t.name }))}
          selectedIds={linkedTeams.map((t) => t.id)}
          onSave={(ids) => setTeams.mutateAsync({ milestoneId, teamIds: ids })}
        />
      )}
      {showReleasesModal && (
        <SelectionModal
          open={showReleasesModal}
          onClose={() => setShowReleasesModal(false)}
          title="Releases"
          items={allReleases.map((r) => ({ id: r.id, name: r.name }))}
          selectedIds={linkedReleases.map((r) => r.id)}
          onSave={(ids) => setReleases.mutateAsync({ milestoneId, releaseIds: ids })}
        />
      )}
    </div>
  )
}