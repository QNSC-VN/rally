import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { notify } from '@/shared/lib/toast'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectTeams, useProjectMembers } from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'
import { TypeBadge, ScheduleStateBadge } from '@/entities/work-item/ui/badges'
import { StatusBadge } from '@/shared/ui/status-badge'
import { TeamCell } from '@/shared/ui/team-cell'
import { ITERATION_STATE_STYLE } from '@/features/iterations/status-colors'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { Spinner } from '@/shared/ui/spinner'
import {
  useIteration,
  useIterations,
  useIterationStatus,
  useCreateIteration,
  useUpdateIteration,
  useCommitIteration,
  useAcceptIteration,
  useRolloverIteration,
  type IterationState,
  type Iteration,
  type IterationStatus,
  type IterationStatusItem,
} from '@/features/iterations/api'

export function CreateIterationModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation('iterations')
  const { workspace, team } = useAppContext()
  const workspaceId = workspace?.workspaceId ?? ''
  // Project auto-fills from context (P2-IT-FR-001C) but an admin may override it
  // (FR-001D); Team then filters by the SELECTED project and must be valid for it.
  const [selectedProjectId, setSelectedProjectId] = useState(projectId)
  const { data: projects = [] } = useProjects(workspaceId || undefined)
  const { data: teams = [] } = useProjectTeams(selectedProjectId)
  const create = useCreateIteration()
  const [name, setName] = useState('')
  // Auto-fill from the Team selected in the workspace context (falls back to "No team")
  const [teamId, setTeamId] = useState<string>(team?.teamId ?? '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [state, setState] = useState<IterationState>('planning')
  const [error, setError] = useState<string | null>(null)

  // A pre-filled/inherited team that isn't linked to the selected project is
  // treated as unset so the create can't be rejected with
  // PROJECT_TEAM_LINK_NOT_FOUND (FR-001D). Derived — no effect needed.
  const validTeamId = teams.some((tm) => tm.id === teamId) ? teamId : ''

  function handleProjectChange(nextProjectId: string) {
    if (nextProjectId === selectedProjectId) return
    setSelectedProjectId(nextProjectId)
    setTeamId('')
  }

  async function submit(openDetail: boolean) {
    setError(null)
    if (!name.trim()) {
      setError(t('create.nameRequired'))
      return
    }
    if (!startDate) {
      setError(t('create.startDateRequired'))
      return
    }
    if (!endDate) {
      setError(t('create.endDateRequired'))
      return
    }
    try {
      const it = await create.mutateAsync({
        projectId: selectedProjectId,
        name: name.trim(),
        teamId: validTeamId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        state,
      })
      notify.success(t('create.created', { name: it.name }))
      if (openDetail) onCreated(it.id)
      else onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('create.createFailed')
      setError(msg)
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('create.title')} width={480}>
      <ModalBody className="space-y-4">
        <FormField label={t('common:name')} required error={error ?? undefined}>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter iteration name..."
          />
        </FormField>
        {/* Type — Phase 2 shows Iterations only, so the control is fixed (P2-IT-FR-003/011). */}
        <FormField label={t('create.typeLabel')}>
          <NativeSelect value="iteration" disabled>
            <option value="iteration">Iteration</option>
          </NativeSelect>
        </FormField>
        {/* Project — auto-filled from context, overridable by admin (P2-IT-FR-001C/D). */}
        <FormField label={t('create.projectLabel')} required>
          <NativeSelect
            value={selectedProjectId}
            onChange={(e) => handleProjectChange(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('create.teamLabel')}>
          <NativeSelect value={validTeamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t('create.startDateLabel')} required>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label={t('create.endDateLabel')} required>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </FormField>
        </div>
        <FormField label={t('create.stateLabel')} required>
          <NativeSelect value={state} onChange={(e) => setState(e.target.value as IterationState)}>
            <option value="planning">Planning</option>
            <option value="committed">Committed</option>
            <option value="accepted">Accepted</option>
          </NativeSelect>
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={create.isPending}
          onClick={() => submit(true)}
        >
          {t('createWithDetails')}
        </Button>
        <Button type="button" disabled={create.isPending} onClick={() => submit(false)}>
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('createButton')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Full-page detail ──────────────────────────────────────────────────────────

export function IterationDetail({
  id,
  canManage,
  onBack,
}: {
  id: string
  canManage: boolean
  onBack: () => void
}) {
  const { t } = useTranslation('iterations')
  const { project } = useAppContext()
  const { data: it, isLoading } = useIteration(id)
  const update = useUpdateIteration(id)
  const { data: teams = [] } = useProjectTeams(it?.projectId)
  const team = teams.find((tm) => tm.id === it?.teamId) ?? null
  const teamName = team?.name ?? null
  const disabled = !canManage
  const readonlyCls =
    'w-full rounded border border-input bg-input-background px-3 py-2 text-ui-md text-foreground'

  function patch(body: Parameters<typeof update.mutateAsync>[0]) {
    void update.mutateAsync(body)
  }

  // Timebox scope + capacity read-model (shared with Iteration Status) and the
  // gated lifecycle actions (Commit / Accept / Rollover).
  const navigate = useNavigate()
  const { data: status } = useIterationStatus(id)
  const { data: members = [] } = useProjectMembers(it?.projectId)
  const { data: allIterations = [] } = useIterations(it?.projectId)
  const commit = useCommitIteration(id)
  const accept = useAcceptIteration(id)
  const [showRollover, setShowRollover] = useState(false)

  const memberName = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of members) if (p.displayName) m.set(p.userId, p.displayName)
    return m
  }, [members])

  async function handleCommit() {
    try {
      await commit.mutateAsync()
      notify.success(t('detail.committed'))
    } catch (e) {
      notify.error(e instanceof Error ? e.message : t('detail.commitFailed'))
    }
  }
  async function handleAccept() {
    try {
      await accept.mutateAsync()
      notify.success(t('detail.accepted'))
    } catch (e) {
      notify.error(e instanceof Error ? e.message : t('detail.acceptFailed'))
    }
  }

  if (isLoading || !it) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const scopeItems = status?.items ?? []
  const unfinishedCount = scopeItems.filter(
    (i) =>
      (i.type === 'story' || i.type === 'defect') &&
      i.scheduleState !== 'accepted' &&
      i.scheduleState !== 'release',
  ).length

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-card">
      <div className="shrink-0 bg-primary-dark text-white">
        <div className="flex h-12 items-center gap-3 px-4">
          <button aria-label="Back" onClick={onBack} className="rounded p-1.5 hover:bg-white/10">
            <ChevronLeft size={18} />
          </button>
          <span className="rounded-sm bg-primary-lighter px-1.5 py-px text-ui-xs font-semibold text-primary">
            {t('detail.typeBadge')}
          </span>
          <span className="font-mono text-ui-lg font-semibold">{it.iterationKey ?? 'New'}</span>
          <span className="h-5 w-px bg-white/25" />
          <h1 className="truncate text-base font-semibold">{it.name}</h1>
          <div className="ml-auto">
            <StatusBadge style={ITERATION_STATE_STYLE[it.state]} />
          </div>
        </div>
      </div>

      {canManage && it.state !== 'accepted' && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-card px-6 py-2">
          <span className="text-ui-md text-muted-foreground">
            {it.state === 'planning'
              ? t('detail.planningHint')
              : t('detail.unfinishedHint', { count: unfinishedCount })}
          </span>
          <div className="flex items-center gap-2">
            {it.state === 'committed' && (
              <Button
                size="sm"
                variant="outline"
                disabled={unfinishedCount === 0}
                onClick={() => setShowRollover(true)}
              >
                {t('detail.moveUnfinished')}
              </Button>
            )}
            {it.state === 'planning' ? (
              <Button size="sm" disabled={commit.isPending} onClick={handleCommit}>
                {commit.isPending && <Loader2 size={11} className="animate-spin" />}{' '}
                {t('detail.commit')}
              </Button>
            ) : (
              <Button size="sm" disabled={accept.isPending} onClick={handleAccept}>
                {accept.isPending && <Loader2 size={11} className="animate-spin" />}{' '}
                {t('detail.accept')}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2 bg-avatar">
        <main className="flex-1 overflow-y-auto bg-surface-subtle p-6">
          <div className="space-y-5">
            <CapacityStrip metrics={status?.metrics} scopeCount={scopeItems.length} />
            <IterationScope
              items={scopeItems}
              memberName={memberName}
              onOpen={(itemKey) => navigate({ to: '/item/$itemKey', params: { itemKey } })}
            />
            <h2 className="text-lg font-semibold text-foreground">{t('detail.details')}</h2>
            <RichTextEditor
              title={t('detail.themeLabel')}
              value={it?.theme}
              minHeight={200}
              readOnly={disabled}
              onSave={(html) => patch({ theme: html || null })}
            />
            <RichTextEditor
              title={t('detail.notesLabel')}
              value={it?.notes}
              minHeight={160}
              readOnly={disabled}
              onSave={(html) => patch({ notes: html || null })}
            />
          </div>
        </main>

        <aside className="w-[320px] shrink-0 space-y-4 overflow-y-auto border-l border-border-subtle bg-card p-5">
          <FormField label={t('detail.projectLabel')}>
            <div className={readonlyCls}>{project?.projectName ?? '—'}</div>
          </FormField>
          <FormField label={t('detail.teamLabel')}>
            {teamName ? (
              <div className={readonlyCls}>
                <TeamCell teamKey={team?.key} name={teamName} />
              </div>
            ) : (
              <div className={readonlyCls}>{t('detail.noTeam')}</div>
            )}
          </FormField>
          <FormField label={t('detail.startDateLabel')}>
            <Input
              type="date"
              value={it.startDate ?? ''}
              disabled={disabled}
              onBlur={(e) => patch({ startDate: e.target.value || null })}
            />
          </FormField>
          <FormField label={t('detail.endDateLabel')}>
            <Input
              type="date"
              value={it.endDate ?? ''}
              disabled={disabled}
              onBlur={(e) => patch({ endDate: e.target.value || null })}
            />
          </FormField>
          <FormField label={t('detail.stateLabel')}>
            <div className="flex h-9 items-center rounded border border-input bg-input-background px-3">
              <StatusBadge style={ITERATION_STATE_STYLE[it.state]} />
            </div>
          </FormField>
          <FormField label={t('detail.plannedVelocityLabel')}>
            <Input
              type="number"
              min={0}
              defaultValue={it.plannedVelocity ?? ''}
              disabled={disabled}
              onBlur={(e) =>
                patch({ plannedVelocity: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="0"
            />
          </FormField>
        </aside>
      </div>

      {showRollover && (
        <RolloverModal
          iterationId={id}
          iterations={allIterations}
          unfinishedCount={unfinishedCount}
          onClose={() => setShowRollover(false)}
        />
      )}
    </div>
  )
}

// ── Capacity strip ────────────────────────────────────────────────────────────

function CapacityStrip({
  metrics,
  scopeCount,
}: {
  metrics: IterationStatus['metrics'] | undefined
  scopeCount: number
}) {
  const { t } = useTranslation('iterations')
  const committed = metrics?.totalPlanEstimate ?? 0
  const capacity = metrics?.plannedVelocity ?? 0
  const capacityPct = capacity > 0 ? Math.round((committed / capacity) * 100) : 0
  const tiles: Array<{ label: string; value: string; caption?: string }> = [
    { label: t('capacity.plannedVelocity'), value: t('capacity.pts', { value: capacity }) },
    {
      label: t('capacity.committed'),
      value: t('capacity.pts', { value: committed }),
      caption: capacity > 0 ? t('capacity.ofCapacity', { pct: capacityPct }) : undefined,
    },
    {
      label: t('capacity.accepted'),
      value: t('capacity.pts', { value: metrics?.acceptedPoints ?? 0 }),
      caption: t('capacity.ofCommitted', { pct: metrics?.acceptedPercent ?? 0 }),
    },
    {
      label: t('capacity.daysLeft'),
      value: metrics?.daysLeft != null ? String(metrics.daysLeft) : '—',
    },
    { label: t('capacity.scopeItems'), value: String(scopeCount) },
    { label: t('capacity.defects'), value: String(metrics?.defectCount ?? 0) },
    { label: t('capacity.tasks'), value: String(metrics?.taskCount ?? 0) },
  ]
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-foreground">{t('capacity.title')}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded border border-border-subtle bg-card px-3 py-2.5">
            <div className="text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
              {tile.label}
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">{tile.value}</div>
            {tile.caption && (
              <div className="text-ui-xs text-foreground-subtle">{tile.caption}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Committed scope list ────────────────────────────────────────────────────────

function IterationScope({
  items,
  memberName,
  onOpen,
}: {
  items: IterationStatusItem[]
  memberName: Map<string, string>
  onOpen: (itemKey: string) => void
}) {
  const { t } = useTranslation('iterations')
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        {t('scope.title')}{' '}
        <span className="text-ui-lg font-normal text-foreground-subtle">({items.length})</span>
      </h2>
      <div className="overflow-hidden rounded border border-border-subtle bg-card">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-ui-lg text-foreground-subtle">
            {t('scope.empty')}
          </div>
        ) : (
          <table className="w-full text-ui-md">
            <thead>
              <tr className="border-b border-border-subtle text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">{t('scope.type')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('scope.id')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('common:name')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('scope.scheduleState')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('scope.est')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('common:owner')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => onOpen(i.itemKey)}
                  className="cursor-pointer border-b border-border-subtle hover:bg-primary-lighter"
                >
                  <td className="px-3 py-2">
                    <TypeBadge type={i.type} />
                  </td>
                  <td className="px-3 py-2 font-mono text-primary">{i.itemKey}</td>
                  <td className="px-3 py-2 text-foreground">{i.title}</td>
                  <td className="px-3 py-2">
                    <ScheduleStateBadge state={i.scheduleState} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {i.planEstimate ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {i.assigneeId ? (memberName.get(i.assigneeId) ?? '—') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

// ── Rollover modal (move unfinished items out) ──────────────────────────────────

function RolloverModal({
  iterationId,
  iterations,
  unfinishedCount,
  onClose,
}: {
  iterationId: string
  iterations: Iteration[]
  unfinishedCount: number
  onClose: () => void
}) {
  const { t } = useTranslation('iterations')
  const rollover = useRolloverIteration(iterationId)
  const [target, setTarget] = useState('') // '' = backlog
  const targets = iterations.filter((it) => it.id !== iterationId && it.state !== 'accepted')

  async function submit() {
    try {
      const res = await rollover.mutateAsync({ moveToIterationId: target || undefined })
      notify.success(t('rollover.moved', { count: res.movedCount }))
      onClose()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : t('rollover.moveFailed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('rollover.title')} width={440}>
      <ModalBody className="space-y-4">
        <p className="text-ui-lg text-muted-foreground">
          {t('rollover.summary', { count: unfinishedCount })}
        </p>
        <FormField label={t('rollover.destination')}>
          <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Backlog (no iteration)</option>
            {targets.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button type="button" disabled={rollover.isPending} onClick={submit}>
          {rollover.isPending && <Loader2 size={11} className="animate-spin" />}{' '}
          {t('rollover.moveItems')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

// (Field removed — use shared <FormField> from @/shared/ui/form-field instead)
