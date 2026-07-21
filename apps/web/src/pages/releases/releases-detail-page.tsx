/**
 * Release Detail Page — P3.2 Release Management
 *
 * Visual layout matching SRS §5 and §6.1 with rich text editing areas (Theme, Notes) on the left
 * and a right sidebar panel for metadata fields, status validation, and task roll-up/acceptance metrics.
 * P3.3: Added Artifacts tab showing linked US/DE work items.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
/* eslint-disable react-hooks/set-state-in-effect */
import { Link, useParams } from '@tanstack/react-router'
import { ChevronLeft, Loader2, Save } from 'lucide-react'
import { InlineSelect } from '@/shared/ui/native-select'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ReleaseArtifactsTab } from './ui/release-artifacts-tab'
import { TaskRollupPanel, BurndownPanel } from './ui/release-detail-panels'
import { RELEASE_STATUS_STYLE } from '@/features/releases/status-colors'
import { useProjectPermissions } from '@/features/access/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useRelease,
  useUpdateRelease,
  useReleaseBurndown,
  type ReleaseStatus,
} from '@/features/releases/api'

const RELEASE_STATES: ReleaseStatus[] = ['planning', 'active', 'accepted']

const STATUS_STYLE = RELEASE_STATUS_STYLE

type TabKey = 'details' | 'artifacts'

export function ReleaseDetailPage() {
  const { releaseId } = useParams({ from: '/auth/releases/$releaseId' })
  const { project } = useAppContext()
  const projectId = project?.projectId ?? ''
  const { can } = useProjectPermissions(projectId || undefined)
  const canManage = can('release:create') || can('release:edit') || can('release:delete')

  const { data: release, isLoading, isError } = useRelease(releaseId)
  const update = useUpdateRelease(releaseId, projectId)
  const { data: burndown, isLoading: burndownLoading } = useReleaseBurndown(releaseId)

  // Local fields state
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [plannedVelocity, setPlannedVelocity] = useState('')
  const [planEstimate, setPlanEstimate] = useState('')
  const [version, setVersion] = useState('')
  const [state, setState] = useState<ReleaseStatus>('planning')
  const [activeTab, setActiveTab] = useState<TabKey>('details')

  useEffect(() => {
    if (release) {
      setName(release.name)
      setStartDate(release.startDate ?? '')
      setReleaseDate(release.releaseDate ?? '')
      setPlannedVelocity(release.plannedVelocity == null ? '' : String(release.plannedVelocity))
      setPlanEstimate(release.planEstimate == null ? '' : String(release.planEstimate))
      setVersion(release.version ?? '')
      setState(release.status)
    }
  }, [release])

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Release name is required')
      return
    }
    if (startDate && releaseDate && releaseDate < startDate) {
      toast.error('Release date must be >= start date')
      return
    }

    try {
      await update.mutateAsync({
        name: name.trim(),
        startDate: startDate || null,
        releaseDate: releaseDate || null,
        plannedVelocity: plannedVelocity ? Number(plannedVelocity) : null,
        planEstimate: planEstimate ? Number(planEstimate) : null,
        version: version.trim() || null,
        state,
      })
      toast.success('Release details saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update release')
    }
  }

  // Rich-text fields (Theme, Notes) auto-save individually on blur, matching
  // the work-item detail page's RichTextEditor pattern.
  async function handleRichFieldSave(patch: { theme?: string | null; notes?: string | null }) {
    try {
      await update.mutateAsync(patch)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update release')
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    )
  }

  if (isError || !release) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background">
        <p className="text-ui-lg text-muted-foreground">Release details could not be loaded.</p>
        <Link to="/releases" className="text-ui-md font-semibold text-primary hover:underline">
          ← Back to Releases
        </Link>
      </div>
    )
  }

  const s = STATUS_STYLE[release.status] ?? STATUS_STYLE.planning
  const rollup = release.taskRollup

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'artifacts', label: 'Artifacts' },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header bar */}
      <div className="bg-surface flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Link
            to="/releases"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-hover"
          >
            <ChevronLeft size={16} />
          </Link>
          <div className="flex items-center gap-3">
            {canManage ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleSave}
                className="w-60 rounded border-0 bg-transparent px-1 py-0.5 text-ui-xl font-semibold text-foreground focus:bg-card focus:ring-1 focus:outline-none"
              />
            ) : (
              <h1 className="text-ui-xl font-semibold text-foreground">{release.name}</h1>
            )}
            <StatusBadge style={s} />
          </div>
        </div>

        {canManage && (
          <Button size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save Changes
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="bg-surface flex shrink-0 items-center gap-0 border-b border-border px-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative px-4 py-2.5 text-ui-md font-medium transition-colors ${
              activeTab === tab.key ? 'text-primary' : 'text-muted-foreground'
            }`}
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
        <ReleaseArtifactsTab releaseId={releaseId} />
      ) : (
        /* Main Grid split — Details tab */
        <div className="flex flex-1 overflow-hidden">
          {/* Left Side: Theme & Notes rich editors */}
          <div className="flex-1 space-y-6 overflow-y-auto p-6">
            <RichTextEditor
              title="Release Theme"
              value={release?.theme}
              minHeight={100}
              readOnly={!canManage}
              onSave={(html) => handleRichFieldSave({ theme: html || null })}
            />
            <RichTextEditor
              title="Notes & Scope Deliverables"
              value={release?.notes}
              minHeight={140}
              readOnly={!canManage}
              onSave={(html) => handleRichFieldSave({ notes: html || null })}
            />
          </div>

          {/* Right Side Panel */}
          <div className="bg-surface w-72 shrink-0 space-y-5 overflow-y-auto border-l border-border p-5">
            <div className="space-y-4">
              <h2 className="text-ui-sm font-semibold tracking-wider text-foreground-subtle uppercase">
                Metadata Details
              </h2>

              <div className="space-y-1">
                <label className="text-ui-xs font-medium text-muted-foreground">
                  Project Scope
                </label>
                <div className="py-1 text-ui-md font-semibold text-foreground">
                  {project?.projectName ?? '—'}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-ui-xs font-medium text-muted-foreground">
                  Lifecycle State
                </label>
                {canManage ? (
                  <InlineSelect
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value as ReleaseStatus)
                      // Auto-trigger save on change
                      void update.mutateAsync({ state: e.target.value as ReleaseStatus })
                    }}
                    className="w-full rounded border border-input bg-card px-2 py-1 text-ui-sm text-foreground focus:outline-none"
                  >
                    {RELEASE_STATES.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_STYLE[st].label}
                      </option>
                    ))}
                  </InlineSelect>
                ) : (
                  <div className="py-1 text-ui-md font-semibold text-foreground">{s.label}</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-ui-xs font-medium text-muted-foreground">Start Date</label>
                  {canManage ? (
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      onBlur={handleSave}
                      className="px-2 py-1 text-ui-sm"
                    />
                  ) : (
                    <div className="font-mono text-ui-md text-foreground">{startDate || '—'}</div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-ui-xs font-medium text-muted-foreground">
                    Release Date
                  </label>
                  {canManage ? (
                    <Input
                      type="date"
                      value={releaseDate}
                      onChange={(e) => setReleaseDate(e.target.value)}
                      onBlur={handleSave}
                      className="px-2 py-1 text-ui-sm"
                    />
                  ) : (
                    <div className="font-mono text-ui-md text-foreground">{releaseDate || '—'}</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-ui-xs font-medium text-muted-foreground">
                    Planned Velocity
                  </label>
                  {canManage ? (
                    <Input
                      type="number"
                      min={0}
                      value={plannedVelocity}
                      onChange={(e) => setPlannedVelocity(e.target.value)}
                      onBlur={handleSave}
                      placeholder="0"
                      className="px-2 py-1 text-ui-sm"
                    />
                  ) : (
                    <div className="font-mono text-ui-md text-foreground">
                      {plannedVelocity || '—'}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-ui-xs font-medium text-muted-foreground">
                    Plan Estimate
                  </label>
                  {canManage ? (
                    <Input
                      type="number"
                      min={0}
                      value={planEstimate}
                      onChange={(e) => setPlanEstimate(e.target.value)}
                      onBlur={handleSave}
                      placeholder="0"
                      className="px-2 py-1 text-ui-sm"
                    />
                  ) : (
                    <div className="font-mono text-ui-md text-foreground">
                      {planEstimate || '—'}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-ui-xs font-medium text-muted-foreground">
                  Version Release Tag
                </label>
                {canManage ? (
                  <Input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    onBlur={handleSave}
                    placeholder="e.g. v2.4.0"
                    className="px-2 py-1 text-ui-sm"
                  />
                ) : (
                  <div className="text-ui-md font-semibold text-foreground">{version || '—'}</div>
                )}
              </div>
            </div>

            {rollup && <TaskRollupPanel rollup={rollup} />}

            <BurndownPanel burndown={burndown} loading={burndownLoading} />
          </div>
        </div>
      )}
    </div>
  )
}
