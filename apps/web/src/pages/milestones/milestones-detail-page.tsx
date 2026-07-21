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
import { Link, useParams } from '@tanstack/react-router'
import { ChevronLeft, Loader2, Save, Users, FolderKanban, Layers, CalendarDays } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { InlineSelect } from '@/shared/ui/native-select'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { RelationButton, ArtifactsTab } from './ui/detail-parts'
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
  async function handleRichFieldSave(patch: {
    description?: string | null
    notes?: string | null
  }) {
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
      <div className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    )
  }

  if (isError || !milestone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background">
        <p className="text-ui-lg text-muted-foreground">Milestone details could not be loaded.</p>
        <Link to="/milestones" className="text-ui-md font-semibold text-primary hover:underline">
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
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header bar */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-card px-4">
        <div className="flex items-center gap-2">
          <Link
            to="/milestones"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-gray-100"
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
                className="rounded border-0 bg-transparent px-1 py-0.5 text-ui-xl font-semibold text-foreground focus:bg-card focus:ring-1 focus:outline-none"
                style={{ width: 320 }}
              />
            ) : (
              <h1 className="text-ui-xl font-semibold text-foreground">{milestone.name}</h1>
            )}
            <span
              className="inline-flex items-center rounded-sm px-1.5 py-px text-ui-xs font-medium"
              style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
            >
              {s.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saving && <Loader2 size={12} className="animate-spin text-primary" />}
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
      <div className="flex shrink-0 items-center gap-0 border-b bg-card px-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="relative px-4 py-2.5 text-ui-md font-medium transition-colors"
            style={{
              color: activeTab === tab.key ? BRAND.primary : BRAND.textSecondary,
            }}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute right-0 bottom-0 left-0 h-0.5 bg-primary" />
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
          <div className="flex-1 space-y-6 overflow-y-auto bg-card p-6">
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
          <div className="w-80 shrink-0 space-y-5 overflow-y-auto border-l bg-card p-5">
            <h2 className="text-ui-sm font-semibold tracking-wider text-foreground-subtle uppercase">
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
            <div className="border-t border-border-subtle" />

            {/* Owner */}
            <div className="space-y-1">
              <label className="text-ui-xs font-medium text-muted-foreground">Owner</label>
              {canManage ? (
                <select
                  value={ownerId}
                  onChange={(e) => {
                    void handleOwnerChange(e.target.value)
                  }}
                  className="w-full cursor-pointer rounded border border-input bg-card px-2 py-1 text-ui-sm text-foreground focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName ?? m.email ?? m.userId}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="py-1 text-ui-md font-semibold text-foreground">
                  {members.find((m) => m.userId === milestone.ownerId)?.displayName ??
                    members.find((m) => m.userId === milestone.ownerId)?.email ??
                    '—'}
                </div>
              )}
            </div>

            {/* Target Start Date (read-only, derived) */}
            <div className="space-y-1">
              <label className="text-ui-xs font-medium text-muted-foreground">
                Target Start Date
              </label>
              <div className="flex items-center gap-1.5">
                <CalendarDays size={12} className="text-foreground-subtle" />
                <span className="font-mono text-ui-md text-foreground">
                  {milestone.targetStartDate ?? '—'}
                </span>
              </div>
              <p className="text-ui-2xs text-foreground-subtle">Derived from linked Releases</p>
            </div>

            {/* Target End Date (read-only, derived) */}
            <div className="space-y-1">
              <label className="text-ui-xs font-medium text-muted-foreground">
                Target End Date
              </label>
              <div className="flex items-center gap-1.5">
                <CalendarDays size={12} className="text-foreground-subtle" />
                <span className="font-mono text-ui-md text-foreground">
                  {milestone.targetEndDate ?? '—'}
                </span>
              </div>
              <p className="text-ui-2xs text-foreground-subtle">Derived from linked Releases</p>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-ui-xs font-medium text-muted-foreground">Status</label>
              {canManage ? (
                <InlineSelect
                  value={status}
                  onChange={(e) => {
                    void handleStatusChange(e.target.value as MilestoneStatus)
                  }}
                  className="w-full rounded border border-input bg-card px-2 py-1 text-ui-sm text-foreground focus:outline-none"
                >
                  {MILESTONE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {STATUS_STYLE[st].label}
                    </option>
                  ))}
                </InlineSelect>
              ) : (
                <span
                  className="inline-flex items-center rounded-sm px-1.5 py-px text-ui-xs font-medium"
                  style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
                >
                  {s.label}
                </span>
              )}
            </div>

            {/* Progress */}
            {milestone.progress && (
              <div className="space-y-2 rounded-md border border-border-subtle bg-surface-hover p-3">
                <h3 className="text-ui-xs font-bold tracking-wider text-muted-foreground uppercase">
                  Progress
                </h3>
                <div className="space-y-1">
                  <div className="flex justify-between text-ui-sm font-semibold text-foreground">
                    <span>Completion</span>
                    <span>{milestone.progress.progressPercent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-avatar">
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
                <div className="grid grid-cols-2 gap-2 text-ui-xs text-foreground-subtle">
                  <div>
                    Items:{' '}
                    <span className="font-semibold text-foreground">
                      {milestone.progress.completedItems}/{milestone.progress.totalItems}
                    </span>
                  </div>
                  <div>
                    Points:{' '}
                    <span className="font-semibold text-foreground">
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
