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
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { ArtifactTable } from '@/entities/work-item/ui/artifact-table'
import { SearchInput } from '@/shared/ui/search-input'
import { MILESTONE_STATUS_STYLE } from '@/features/milestones/status-colors'
import { Button } from '@/shared/ui/button'
import { SelectionModal } from '@/shared/ui/selection-modal'
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
} from '@/features/milestones/api'
import { useReleasesForProjects } from '@/features/releases/api'
import { useWorkspaceTeams } from '@/features/teams/api'
import { useProjectMembers } from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'

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
        <ArtifactTable
          items={items}
          isLoading={isLoading}
          search={search}
          entityNoun="milestone"
          startIndex={cursorHistory.length * pageSize}
          onOpenItem={(item) =>
            navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
          }
        />
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
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={!pageInfo?.hasNextPage}
              onClick={onNextPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
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
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId ?? ''

  const { data: milestone, isLoading, isError } = useMilestone(milestoneId)
  const update = useUpdateMilestone()

  // Relation data (arrays of linked entity IDs)
  const { data: linkedProjectIds = [] } = useMilestoneProjects(milestoneId)
  const { data: linkedTeamIds = [] } = useMilestoneTeams(milestoneId)
  const { data: linkedReleaseIds = [] } = useMilestoneReleases(milestoneId)

  // Permissions and member/release lookups are scoped to the milestone's OWN
  // project(s) — not the app-context project — so the page is correct no matter
  // which project the workspace selector currently points at (DEV-006).
  const milestoneProjectId = milestone?.projectId ?? ''
  const { can } = useProjectPermissions(milestoneProjectId || undefined)
  const canManage = can('milestone:create') || can('milestone:edit') || can('milestone:delete')

  // A milestone may span multiple projects; offer releases from every linked
  // project (unioned with its home project) as selectable options.
  const releaseProjectIds = useMemo(
    () => [...new Set([milestoneProjectId, ...linkedProjectIds].filter(Boolean))],
    [milestoneProjectId, linkedProjectIds],
  )

  // Available items for selection modals
  const { data: allProjects = [] } = useProjects(workspaceId || undefined)
  const { data: allTeams = [] } = useWorkspaceTeams(workspaceId || undefined)
  const { data: allReleases = [] } = useReleasesForProjects(releaseProjectIds)
  const { data: members = [] } = useProjectMembers(milestoneProjectId || undefined)

  // Set mutations
  const setProjects = useSetMilestoneProjects()
  const setTeams = useSetMilestoneTeams()
  const setReleases = useSetMilestoneReleases()

  // Local state
  const [name, setName] = useState('')
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
        status,
        ownerId: ownerId || null,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Rich-text fields (Description, Notes) auto-save individually on blur, matching
  // the work-item detail page's RichTextEditor pattern.
  async function handleRichFieldSave(patch: { description?: string | null; notes?: string | null }) {
    if (!milestone) return
    try {
      await update.mutateAsync({ id: milestone.id, ...patch })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
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
            <Button size="sm" onClick={handleFieldSave} disabled={update.isPending || saving}>
              {update.isPending || saving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              Save Changes
            </Button>
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
            <RichTextEditor
              title="Description"
              value={milestone?.description}
              minHeight={120}
              readOnly={!canManage}
              onSave={(html) => handleRichFieldSave({ description: html || null })}
            />
            <RichTextEditor
              title="Notes"
              value={milestone?.notes}
              minHeight={80}
              readOnly={!canManage}
              onSave={(html) => handleRichFieldSave({ notes: html || null })}
            />
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
              count={linkedProjectIds.length}
              onClick={() => setShowProjectsModal(true)}
              canManage={canManage}
            />

            {/* Teams */}
            <RelationButton
              icon={Users}
              label="Teams"
              count={linkedTeamIds.length}
              onClick={() => setShowTeamsModal(true)}
              canManage={canManage}
            />

            {/* Releases */}
            <RelationButton
              icon={Layers}
              label="Releases"
              count={linkedReleaseIds.length}
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
                style={{
                  backgroundColor: BRAND.surfaceHover,
                  border: `1px solid ${BRAND.borderSubtle}`,
                }}
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
                    style={{ backgroundColor: BRAND.avatarBg }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${milestone.progress.progressPercent}%`,
                        backgroundColor:
                          milestone.progress.progressPercent === 100
                            ? BRAND.success
                            : BRAND.primaryLight,
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
          selectedIds={linkedProjectIds}
          onSave={(ids) => setProjects.mutateAsync({ milestoneId, projectIds: ids })}
        />
      )}
      {showTeamsModal && (
        <SelectionModal
          open={showTeamsModal}
          onClose={() => setShowTeamsModal(false)}
          title="Teams"
          items={allTeams.map((t) => ({ id: t.id, name: t.name }))}
          selectedIds={linkedTeamIds}
          onSave={(ids) => setTeams.mutateAsync({ milestoneId, teamIds: ids })}
        />
      )}
      {showReleasesModal && (
        <SelectionModal
          open={showReleasesModal}
          onClose={() => setShowReleasesModal(false)}
          title="Releases"
          items={allReleases.map((r) => ({ id: r.id, name: r.name }))}
          selectedIds={linkedReleaseIds}
          onSave={(ids) => setReleases.mutateAsync({ milestoneId, releaseIds: ids })}
        />
      )}
    </div>
  )
}
