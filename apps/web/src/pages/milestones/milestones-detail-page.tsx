/**
 * Milestone Detail Page — P3.3
 *
 * Two-panel layout with Details / Artifacts tabs matching the Release detail page pattern.
 * Details tab: left panel (description, notes) + right sidebar (projects, teams, releases, owner, dates, status).
 * Artifacts tab: backlog-style table of assigned US/DE work items with search + pagination.
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
/* eslint-disable react-hooks/set-state-in-effect */
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  Users,
  FolderKanban,
  Layers,
  CalendarDays,
} from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { InlineSelect } from '@/shared/ui/native-select'
import { Textarea } from '@/shared/ui/textarea'
import { SkeletonList } from '@/shared/ui/skeleton'
import { SearchInput } from '@/shared/ui/search-input'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { MILESTONE_STATUS_STYLE } from '@/features/milestones/status-colors'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { useProjectPermissions } from '@/features/access/api'
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

const STATUS_STYLE = MILESTONE_STATUS_STYLE

const MILESTONE_STATUSES: MilestoneStatus[] = [
  'planned',
  'at_risk',
  'met',
  'missed',
  'cancelled',
  'completed',
]

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
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search ${title.toLowerCase()}...`}
          ariaLabel={`Search ${title.toLowerCase()}`}
          iconSize={13}
          autoFocus
          className="w-full rounded-md py-1.5 pl-8 text-xs"
        />
      </div>
      <ModalBody className="space-y-1">
        {/* Select-all row */}
        <label
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-[11px] font-semibold select-none hover:bg-gray-50"
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
            <p className="py-4 text-center text-xs" style={{ color: BRAND.textMuted }}>
              No items found
            </p>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs transition-colors select-none hover:bg-gray-50"
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
          className="cursor-pointer rounded-md px-4 py-1.5 text-sm"
          style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void handleSave()
          }}
          disabled={saving}
          className="flex cursor-pointer items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-80"
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

// ── Artifacts table row ────────────────────────────────────────────────────────

function ArtifactRow({
  item,
  index,
  onOpen,
}: {
  item: ArtifactItem
  index: number
  onOpen: () => void
}) {
  return (
    <tr
      className="cursor-pointer transition-colors duration-75"
      style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = BRAND.surfaceHover)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      onClick={onOpen}
    >
      {/* Rank */}
      <td
        className="h-8 px-3 text-center font-mono text-[10px] tabular-nums"
        style={{ color: BRAND.textMuted }}
      >
        {index + 1}
      </td>
      {/* ID */}
      <td
        className="h-8 px-3 font-mono text-[10px] underline-offset-2 hover:underline"
        style={{ color: BRAND.primaryLight }}
      >
        {item.itemKey}
      </td>
      {/* Name */}
      <td className="h-8 px-3">
        <span
          className="block max-w-[300px] truncate text-xs font-medium"
          style={{ color: BRAND.textPrimary }}
        >
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
      <td
        className="h-8 px-3 text-center font-mono text-[10px]"
        style={{ color: BRAND.textSecondary }}
      >
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
        className="flex shrink-0 items-center gap-3 px-4 py-2"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}`, backgroundColor: BRAND.surface }}
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search artifacts..."
          ariaLabel="Search artifacts"
          width={220}
          iconSize={13}
          className="rounded-md py-1.5 pl-8 text-xs"
        />
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
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8">
            <Layers size={32} style={{ color: '#c4cad4' }} />
            <p className="text-xs" style={{ color: BRAND.textMuted }}>
              {search ? 'No artifacts match your search' : 'No artifacts linked to this milestone'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr
                className="text-[9px] font-semibold tracking-wider uppercase select-none"
                style={{
                  backgroundColor: BRAND.surfaceHover,
                  borderBottom: `1px solid ${BRAND.border}`,
                }}
              >
                <th
                  className="h-7 w-12 px-3 text-center font-medium"
                  style={{ color: BRAND.textMuted }}
                >
                  #
                </th>
                <th className="h-7 w-20 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  ID
                </th>
                <th className="h-7 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Name
                </th>
                <th className="h-7 w-14 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Type
                </th>
                <th className="h-7 w-24 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Schedule State
                </th>
                <th className="h-7 w-16 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Priority
                </th>
                <th className="h-7 w-28 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Owner
                </th>
                <th
                  className="h-7 w-14 px-3 text-center font-medium"
                  style={{ color: BRAND.textMuted }}
                >
                  Est.
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <ArtifactRow
                  key={item.id}
                  item={item}
                  index={cursorHistory.length * pageSize + idx}
                  onOpen={() =>
                    navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
                  }
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
          style={{ borderTop: `1px solid ${BRAND.borderSubtle}` }}
        >
          <div
            className="flex items-center gap-2 text-[11px]"
            style={{ color: BRAND.textSecondary }}
          >
            <span>Rows per page</span>
            <InlineSelect
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-auto"
            >
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </InlineSelect>
            <span style={{ color: BRAND.textMuted }}>
              {pageInfo
                ? `${(currentPage - 1) * pageSize + 1}–${(currentPage - 1) * pageSize + items.length}${pageInfo.total ? ` of ${pageInfo.total}` : ''}`
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
              Page {currentPage}
            </span>
            <button
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={onPrevPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: '1px solid #dde2ea', color: BRAND.textSecondary }}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={!pageInfo?.hasNextPage}
              onClick={onNextPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: '1px solid #dde2ea', color: BRAND.textSecondary }}
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
  const { milestoneId } = useParams({ from: '/auth/milestones/$milestoneId' })
  const { project, workspace } = useAppContext()
  const projectId = project?.projectId ?? ''
  const workspaceId = workspace?.workspaceId ?? ''
  const { can } = useProjectPermissions(projectId || undefined)
  const canManage = can('milestone:manage')

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
      <div
        className="flex flex-1 items-center justify-center"
        style={{ backgroundColor: BRAND.pageBg }}
      >
        <Loader2 className="animate-spin" size={24} style={{ color: BRAND.primary }} />
      </div>
    )
  }

  if (isError || !milestone) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3"
        style={{ backgroundColor: BRAND.pageBg }}
      >
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Milestone details could not be loaded.
        </p>
        <Link
          to="/milestones"
          className="text-[12px] font-semibold hover:underline"
          style={{ color: BRAND.primary }}
        >
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
    <div className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: BRAND.pageBg }}>
      {/* Header bar */}
      <div
        className="flex h-12 shrink-0 items-center justify-between gap-4 px-4"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        <div className="flex items-center gap-2">
          <Link
            to="/milestones"
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-gray-100"
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFieldSave()
                }}
                className="rounded border-0 bg-transparent px-1 py-0.5 text-[14px] font-semibold focus:bg-white focus:ring-1 focus:outline-none"
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
          {saving && (
            <Loader2 size={12} className="animate-spin" style={{ color: BRAND.primary }} />
          )}
          {canManage && (
            <button
              onClick={handleFieldSave}
              disabled={update.isPending || saving}
              className="flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: BRAND.primary }}
            >
              {update.isPending || saving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              Save Changes
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-0 px-4"
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
                className="absolute right-0 bottom-0 left-0 h-0.5"
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
          <div
            className="flex-1 space-y-6 overflow-y-auto p-6"
            style={{ backgroundColor: BRAND.surface }}
          >
            <div className="space-y-2">
              <h2
                className="text-[12px] font-semibold tracking-wider uppercase"
                style={{ color: BRAND.textSecondary }}
              >
                Description
              </h2>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleFieldSave}
                disabled={!canManage}
                placeholder="Enter milestone description..."
                rows={6}
                className="w-full rounded-md border p-3 text-[12px] focus:ring-1 focus:outline-none"
                style={{
                  borderColor: BRAND.border,
                  backgroundColor: BRAND.surface,
                  color: BRAND.textPrimary,
                }}
              />
            </div>

            <div className="space-y-2">
              <h2
                className="text-[12px] font-semibold tracking-wider uppercase"
                style={{ color: BRAND.textSecondary }}
              >
                Notes
              </h2>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={handleFieldSave}
                disabled={!canManage}
                placeholder="Add internal notes..."
                rows={10}
                className="w-full rounded-md border p-3 text-[12px] focus:ring-1 focus:outline-none"
                style={{
                  borderColor: BRAND.border,
                  backgroundColor: BRAND.surface,
                  color: BRAND.textPrimary,
                }}
              />
            </div>
          </div>

          {/* Right sidebar (320px, scrollable) */}
          <div
            className="w-80 shrink-0 space-y-5 overflow-y-auto border-l p-5"
            style={{ backgroundColor: BRAND.surface, borderColor: BRAND.border }}
          >
            <h2
              className="text-[11px] font-semibold tracking-wider uppercase"
              style={{ color: BRAND.textMuted }}
            >
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
              <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                Owner
              </label>
              {canManage ? (
                <select
                  value={ownerId}
                  onChange={(e) => {
                    void handleOwnerChange(e.target.value)
                  }}
                  className="w-full cursor-pointer rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
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
                <div
                  className="py-1 text-[12px] font-semibold"
                  style={{ color: BRAND.textPrimary }}
                >
                  {members.find((m) => m.userId === milestone.ownerId)?.displayName ??
                    members.find((m) => m.userId === milestone.ownerId)?.email ??
                    '—'}
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
                <span className="font-mono text-[12px]" style={{ color: BRAND.textPrimary }}>
                  {milestone.targetStartDate ?? '—'}
                </span>
              </div>
              <p className="text-[9px]" style={{ color: BRAND.textMuted }}>
                Derived from linked Releases
              </p>
            </div>

            {/* Target End Date (read-only, derived) */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                Target End Date
              </label>
              <div className="flex items-center gap-1.5">
                <CalendarDays size={12} style={{ color: BRAND.textMuted }} />
                <span className="font-mono text-[12px]" style={{ color: BRAND.textPrimary }}>
                  {milestone.targetEndDate ?? '—'}
                </span>
              </div>
              <p className="text-[9px]" style={{ color: BRAND.textMuted }}>
                Derived from linked Releases
              </p>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                Status
              </label>
              {canManage ? (
                <InlineSelect
                  value={status}
                  onChange={(e) => {
                    void handleStatusChange(e.target.value as MilestoneStatus)
                  }}
                  className="w-full rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
                  style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
                >
                  {MILESTONE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {STATUS_STYLE[st].label}
                    </option>
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
                className="space-y-2 rounded-md p-3"
                style={{ backgroundColor: '#f8fafc', border: `1px solid ${BRAND.borderSubtle}` }}
              >
                <h3
                  className="text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: BRAND.textSecondary }}
                >
                  Progress
                </h3>
                <div className="space-y-1">
                  <div
                    className="flex justify-between text-[11px] font-semibold"
                    style={{ color: BRAND.textPrimary }}
                  >
                    <span>Completion</span>
                    <span>{milestone.progress.progressPercent}%</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: '#e2e8f0' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${milestone.progress.progressPercent}%`,
                        backgroundColor:
                          milestone.progress.progressPercent === 100 ? '#16a34a' : '#2563eb',
                      }}
                    />
                  </div>
                </div>
                <div
                  className="grid grid-cols-2 gap-2 text-[10px]"
                  style={{ color: BRAND.textMuted }}
                >
                  <div>
                    Items:{' '}
                    <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
                      {milestone.progress.completedItems}/{milestone.progress.totalItems}
                    </span>
                  </div>
                  <div>
                    Points:{' '}
                    <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
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
