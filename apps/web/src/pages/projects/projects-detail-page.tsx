/**
 * Project Detail Page — mirrors the Work Item / Release / Milestone detail
 * template: a two-pane Details view with INLINE editing (deferred Save/Cancel),
 * reached by clicking a row on the Projects list. Create stays a modal; there is
 * no separate Edit modal — fields are edited here and on the list inline.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { FileText, History, Loader2, Users } from 'lucide-react'
import { ActivityHistoryTab } from '@/entities/activity/ui/activity-history-tab'
import { listResource } from '@/shared/lib/query/resource'
import { DetailLayout, DetailTwoPane } from '@/shared/ui/detail/detail-layout'
import { DetailField, DetailReadonlyValue } from '@/shared/ui/detail/detail-field'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { OwnerSelectField } from '@/shared/ui/entity-select-field'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { DateField } from '@/shared/ui/date-field'
import { SaveCancelBar } from '@/shared/ui/save-cancel-bar'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { TeamAvatar } from '@/shared/ui/team-cell'
import { formatDateIso } from '@/shared/lib/utils'
import { usePendingPatch } from '@/shared/lib/hooks/use-pending-patch'
import { useProjectPermissions } from '@/features/access/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useProjects,
  useUpdateProject,
  useProjectActivityLog,
  type Project,
  type UpdateProjectInput,
} from '@/features/projects/api'
import {
  useProjectMemberOptions,
  useProjectTeams,
  useWorkspaceTeams,
  useLinkProjectTeam,
  useUnlinkProjectTeam,
} from '@/features/teams/api'

type TabKey = 'details' | 'history'

/** Plain-text content of an HTML string, for text-equality comparison. */
const stripTags = (html: string | null | undefined): string =>
  (html ?? '').replace(/<[^>]*>/g, '').trim()

export function ProjectDetailPage() {
  const { t } = useTranslation('projects')
  const navigate = useNavigate()
  const { projectKey } = useParams({ from: '/auth/projects/$projectKey' })
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId ?? ''

  // The record is resolved out of the LIST — there is no `GET /projects/by-key` — so this page
  // inherits the list's paging. `isLoadingMore` is therefore load-bearing here and not a nicety: with
  // the drain, a project on page 2 is genuinely absent from `rows` for one round trip, and the
  // not-found branch below would have claimed it does not exist. See `useProjects`.
  const projectsQuery = useProjects(workspaceId || undefined)
  const projectsRes = listResource(projectsQuery)
  const project = projectsRes.rows.find((p) => p.key === projectKey)
  // Waits on the remaining pages only while the record is still MISSING: found on page 1, it renders
  // at once, so the drain costs nothing in the ordinary case.
  const isLoading = projectsRes.isLoading || (!project && projectsQuery.isLoadingMore)
  const isError = projectsRes.isError
  const update = useUpdateProject()

  const { can } = useProjectPermissions(project?.id)
  // Archived projects are read-only (the backend rejects edits on them).
  const canManage = can('project:edit') && project?.status === 'active'

  const [activeTab, setActiveTab] = useState<TabKey>('details')
  const activityQuery = useProjectActivityLog(project?.id)
  const activityLogs = listResource(activityQuery)

  // Feeds the Lead OwnerSelectField — a PICKER, so the reference feed. The administrative roster
  // is Workspace-Admin/Project-Admin only and a 403 there defaults to `[]`, which renders a real
  // lead as no lead.
  const { data: members = [] } = useProjectMemberOptions(project?.id)
  const { data: teams = [] } = useProjectTeams(project?.id)
  const { data: allTeams = [] } = useWorkspaceTeams(workspaceId || undefined)
  const linkTeam = useLinkProjectTeam(project?.id ?? '')
  const unlinkTeam = useUnlinkProjectTeam(project?.id ?? '')

  const {
    value: p,
    isDirty,
    saving,
    setField,
    save,
    cancel,
  } = usePendingPatch<Project, UpdateProjectInput>(
    project ?? ({} as Project),
    project?.id ?? '',
    async (patch) => {
      try {
        return await update.mutateAsync({ id: project!.id, input: patch })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('detail.saveFailed'))
        throw err
      }
    },
  )

  function handleSave() {
    if (!(p.name ?? '').trim()) {
      toast.error(t('detail.nameRequired'))
      return
    }
    void save().catch(() => {})
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    )
  }

  if (isError || !project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background">
        <p className="text-ui-lg text-muted-foreground">{t('detail.loadError')}</p>
        <Link to="/projects" className="text-ui-md font-semibold text-primary hover:underline">
          {t('detail.backToProjects')}
        </Link>
      </div>
    )
  }

  return (
    <DetailLayout
      onBack={() => void navigate({ to: '/projects' })}
      badge={<TypeBadge type="project" />}
      itemKey={project.key}
      title={
        canManage ? (
          <input
            value={p.name ?? ''}
            onChange={(e) => setField({ name: e.target.value })}
            className="w-80 rounded border-0 bg-transparent px-1 py-0.5 text-base font-semibold text-white placeholder-white/60 focus:bg-white/10 focus:outline-none"
            aria-label={t('common:name')}
          />
        ) : (
          project.name
        )
      }
      tabs={[
        { key: 'details', label: t('detail.tabs.details'), icon: <FileText size={19} /> },
        { key: 'history', label: t('detail.tabs.history', 'History'), icon: <History size={19} /> },
      ]}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as TabKey)}
    >
      {activeTab === 'history' ? (
        <div className="flex-1 overflow-y-auto bg-card p-6">
          <ActivityHistoryTab
            logs={activityLogs}
            title={t('detail.historyTitle', 'Revision History')}
            subtitle={t('detail.historySubtitle', 'Every change to this project, newest first.')}
          />
        </div>
      ) : (
        <>
          <DetailTwoPane
            sidebarTitle={t('detail.metadataDetails')}
            main={
              <RichTextEditor
                title={t('common:description')}
                value={p.description}
                minHeight={120}
                readOnly={!canManage}
                // Legacy project descriptions are stored as plain text; the editor
                // normalizes them to <p>…</p> on mount and fires onChange. Ignore
                // that (and any no-op) so the form isn't spuriously dirty on load —
                // only register a change when the text content actually differs.
                onChange={(html) => {
                  if (stripTags(html) === stripTags(project.description)) return
                  setField({ description: html || null })
                }}
              />
            }
            sidebar={
              <>
                <OwnerSelectField
                  label={t('fields.lead')}
                  value={p.leadId ?? ''}
                  onChange={(v) => setField({ leadId: v || null })}
                  members={members}
                  disabled={!canManage}
                />

                <DetailField label={t('detail.startDate')}>
                  <DateField
                    variant="field"
                    value={p.startDate ?? null}
                    readOnly={!canManage}
                    ariaLabel={t('detail.startDate')}
                    onChange={canManage ? (v) => setField({ startDate: v }) : undefined}
                  />
                </DetailField>

                <DetailField label={t('detail.endDate', 'End Date')}>
                  <DateField
                    variant="field"
                    value={p.endDate ?? null}
                    readOnly={!canManage}
                    ariaLabel={t('detail.endDate', 'End Date')}
                    onChange={canManage ? (v) => setField({ endDate: v }) : undefined}
                  />
                </DetailField>

                <DetailField label={t('common:status')}>
                  <SearchableSelect
                    variant="field"
                    value={p.status ?? 'active'}
                    readOnly={!canManage}
                    ariaLabel={t('common:status')}
                    options={[
                      { value: 'active', label: t('status.active') },
                      { value: 'archived', label: t('status.archived') },
                    ]}
                    onChange={(v) => setField({ status: v as 'active' | 'archived' })}
                  />
                </DetailField>

                {/* Teams — a Project links MANY teams (M2M). Edited via the dedicated
                link/unlink endpoints (the project PATCH carries no teamIds), so
                each add/remove commits immediately from the multi-select diff. */}
                <DetailField label={t('fields.teams')}>
                  <SearchableSelect
                    variant="field"
                    multiple
                    value={teams.map((tm) => tm.id)}
                    readOnly={!canManage}
                    ariaLabel={t('fields.teams')}
                    placeholder="--"
                    searchPlaceholder="Search"
                    options={allTeams.map((tm) => ({
                      value: tm.id,
                      label: tm.name,
                      searchText: tm.name,
                      icon: <TeamAvatar teamKey={tm.key} name={tm.name} size={16} />,
                    }))}
                    onChange={(ids) => {
                      const next = ids as string[]
                      const cur = teams.map((tm) => tm.id)
                      next.filter((id) => !cur.includes(id)).forEach((id) => linkTeam.mutate(id))
                      cur.filter((id) => !next.includes(id)).forEach((id) => unlinkTeam.mutate(id))
                    }}
                  />
                </DetailField>

                <DetailField label={t('detail.members')}>
                  <DetailReadonlyValue>
                    <Users size={13} className="mr-1.5 text-foreground-subtle" />
                    {project.memberCount}
                  </DetailReadonlyValue>
                </DetailField>

                <DetailField label={t('detail.created')}>
                  <DetailReadonlyValue>{formatDateIso(project.createdAt)}</DetailReadonlyValue>
                </DetailField>
              </>
            }
          />
          <SaveCancelBar
            visible={isDirty && !!canManage}
            saving={saving}
            errorMsg={null}
            onSave={handleSave}
            onCancel={cancel}
          />
        </>
      )}
    </DetailLayout>
  )
}
