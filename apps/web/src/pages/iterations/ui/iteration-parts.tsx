import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { FileText, History, Loader2 } from 'lucide-react'
import { notify } from '@/shared/lib/toast'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectTeams, useProjectMembers } from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import type { ScheduleState } from '@/entities/work-item/model/types'
import { TeamAvatar } from '@/shared/ui/team-cell'
import { TeamSelectField } from '@/shared/ui/entity-select-field'
import { ITERATION_STATE_STYLE } from '@/features/iterations/status-colors'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { DateField } from '@/shared/ui/date-field'
import { NativeSelect } from '@/shared/ui/native-select'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { SaveCancelBar } from '@/shared/ui/save-cancel-bar'
import { usePendingPatch } from '@/shared/lib/hooks/use-pending-patch'
import { DetailLayout, DetailTwoPane } from '@/shared/ui/detail/detail-layout'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { IterationHistoryTab } from './iteration-history-tab'
import {
  DetailField,
  DetailFieldPair,
  DetailReadonlyValue,
} from '@/shared/ui/detail/detail-field'
import { Spinner } from '@/shared/ui/spinner'
import {
  useIteration,
  useIterations,
  useIterationStatus,
  useCreateIteration,
  useUpdateIteration,
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
          <SearchableSelect
            variant="field"
            value={selectedProjectId}
            ariaLabel={t('create.projectLabel')}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            onChange={handleProjectChange}
          />
        </FormField>
        <FormField label={t('create.teamLabel')}>
          <SearchableSelect
            variant="field"
            value={validTeamId}
            ariaLabel={t('create.teamLabel')}
            placeholder="No team"
            options={[
              { value: '', label: 'No team' },
              ...teams.map((tm) => ({
                value: tm.id,
                label: tm.name,
                icon: <TeamAvatar teamKey={tm.key} name={tm.name} size={16} />,
              })),
            ]}
            onChange={setTeamId}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t('create.startDateLabel')} required>
            <DateField
              variant="field"
              value={startDate || null}
              ariaLabel={t('create.startDateLabel')}
              onChange={(v) => setStartDate(v ?? '')}
            />
          </FormField>
          <FormField label={t('create.endDateLabel')} required>
            <DateField
              variant="field"
              value={endDate || null}
              ariaLabel={t('create.endDateLabel')}
              onChange={(v) => setEndDate(v ?? '')}
            />
          </FormField>
        </div>
        <FormField label={t('create.stateLabel')} required>
          <SearchableSelect
            variant="field"
            ariaLabel={t('create.stateLabel')}
            value={state}
            options={(['planning', 'committed', 'accepted'] as IterationState[]).map((s) => ({
              value: s,
              label: ITERATION_STATE_STYLE[s].label,
            }))}
            onChange={(v) => setState(v as IterationState)}
          />
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
  const disabled = !canManage

  // Broadcom-Rally-style deferred save (matches the Work Item detail page): field
  // edits accumulate locally and commit together via the floating Save/Cancel bar
  // instead of auto-saving each field on blur. Lifecycle actions (Commit / Accept
  // / Rollover) below remain immediate — they aren't field edits.
  const {
    value: vit,
    isDirty,
    saving,
    setField,
    save,
    cancel,
  } = usePendingPatch<Iteration, Parameters<typeof update.mutateAsync>[0]>(
    it ?? ({} as Iteration),
    id,
    async (body) => {
      try {
        return await update.mutateAsync(body)
      } catch (e) {
        notify.error(e instanceof Error ? e.message : t('detail.saveFailed', 'Failed to save'))
        throw e
      }
    },
  )

  // Timebox scope + capacity read-model (shared with Iteration Status) and the
  // gated lifecycle actions (Commit / Accept / Rollover).
  const navigate = useNavigate()
  const { data: status } = useIterationStatus(id)
  const { data: members = [] } = useProjectMembers(it?.projectId)
  const { data: allIterations = [] } = useIterations(it?.projectId)
  const [showRollover, setShowRollover] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')

  const memberName = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of members) if (p.displayName) m.set(p.userId, p.displayName)
    return m
  }, [members])

  // State is a gated lifecycle transition (not a free field), so — like the
  // /timeboxes list row — it saves IMMEDIATELY through the update mutation (the
  // backend routes it to Commit/Accept and rejects invalid jumps), rather than
  // through the deferred Save/Cancel patch used by the other fields.
  function saveState(v: string) {
    if (!it || v === it.state) return
    void update.mutateAsync({ state: v as IterationState }).then(
      () => notify.success(t('detail.stateUpdated', 'State updated')),
      (e: unknown) => notify.error(e instanceof Error ? e.message : t('detail.saveFailed', 'Failed to save')),
    )
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

  const tabs = [
    { key: 'details', label: t('detail.details'), icon: <FileText size={19} /> },
    {
      key: 'history',
      label: t('detail.history', 'Revision History'),
      icon: <History size={19} />,
    },
  ]

  return (
    <>
      <DetailLayout
        onBack={onBack}
        badge={<TypeBadge type="iteration" />}
        itemKey={it.iterationKey ?? 'New'}
        title={
          disabled ? (
            it.name
          ) : (
            <input
              value={vit.name ?? ''}
              onChange={(e) => setField({ name: e.target.value })}
              className="w-full rounded border-0 bg-transparent px-1 py-0.5 text-base font-semibold text-white placeholder-white/60 focus:bg-white/10 focus:outline-none"
              aria-label="Name"
            />
          )
        }
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(k) => setActiveTab(k as 'details' | 'history')}
      >
        {activeTab === 'history' ? (
          <div className="flex-1 overflow-y-auto bg-card p-6">
            <IterationHistoryTab iterationId={id} />
          </div>
        ) : (
          <>
        <DetailTwoPane
          sidebarTitle={t('detail.details')}
          main={
            <>
              {canManage && it.state !== 'accepted' && (
                <p className="text-ui-md text-muted-foreground">
                  {it.state === 'planning'
                    ? t('detail.planningHint')
                    : t('detail.unfinishedHint', { count: unfinishedCount })}
                </p>
              )}
              <CapacityStrip metrics={status?.metrics} scopeCount={scopeItems.length} />
              <IterationScope
                items={scopeItems}
                memberName={memberName}
                onOpen={(itemKey) => navigate({ to: '/item/$itemKey', params: { itemKey } })}
              />
              <RichTextEditor
                title={t('detail.themeLabel')}
                value={vit.theme}
                minHeight={200}
                readOnly={disabled}
                onChange={(html) => setField({ theme: html || null })}
              />
              <RichTextEditor
                title={t('detail.notesLabel')}
                value={vit.notes}
                minHeight={160}
                readOnly={disabled}
                onChange={(html) => setField({ notes: html || null })}
              />
            </>
          }
          sidebar={
            <div className="space-y-4">
              <DetailField label={t('detail.projectLabel')}>
                <DetailReadonlyValue>{project?.projectName ?? '—'}</DetailReadonlyValue>
              </DetailField>

              <TeamSelectField
                label={t('detail.teamLabel')}
                value={vit.teamId}
                onChange={(v) => setField({ teamId: v || null })}
                teams={teams}
                disabled={disabled}
                placeholder={t('detail.noTeam')}
              />

              <DetailFieldPair>
                <DetailField label={t('detail.startDateLabel')}>
                  <DateField
                    variant="field"
                    value={vit.startDate}
                    readOnly={disabled}
                    ariaLabel={t('detail.startDateLabel')}
                    onChange={disabled ? undefined : (v) => setField({ startDate: v })}
                  />
                </DetailField>
                <DetailField label={t('detail.endDateLabel')}>
                  <DateField
                    variant="field"
                    value={vit.endDate}
                    readOnly={disabled}
                    ariaLabel={t('detail.endDateLabel')}
                    onChange={disabled ? undefined : (v) => setField({ endDate: v })}
                  />
                </DetailField>
              </DetailFieldPair>

              <DetailField label={t('detail.stateLabel')}>
                <SearchableSelect
                  variant="field"
                  value={it.state}
                  readOnly={disabled}
                  ariaLabel={t('detail.stateLabel')}
                  options={(['planning', 'committed', 'accepted'] as IterationState[]).map((s) => ({
                    value: s,
                    label: ITERATION_STATE_STYLE[s].label,
                  }))}
                  onChange={saveState}
                />
              </DetailField>

              <DetailField label={t('detail.plannedVelocityLabel')}>
                {!disabled ? (
                  <Input
                    type="number"
                    min={0}
                    value={vit.plannedVelocity ?? ''}
                    onChange={(e) =>
                      setField({
                        plannedVelocity: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder="0"
                  />
                ) : (
                  <DetailReadonlyValue mono>{vit.plannedVelocity ?? '—'}</DetailReadonlyValue>
                )}
              </DetailField>
            </div>
          }
        />
        <SaveCancelBar
          visible={isDirty && !disabled}
          saving={saving}
          errorMsg={null}
          onSave={() => void save().catch(() => {})}
          onCancel={cancel}
        />
          </>
        )}
      </DetailLayout>

      {showRollover && (
        <RolloverModal
          iterationId={id}
          iterations={allIterations}
          unfinishedCount={unfinishedCount}
          onClose={() => setShowRollover(false)}
        />
      )}
    </>
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
                  className="border-b border-border-subtle hover:bg-primary-lighter"
                >
                  <td className="px-3 py-2">
                    <IdCell type={i.type} itemKey={i.itemKey} onOpen={() => onOpen(i.itemKey)} />
                  </td>
                  <td className="px-3 py-2 text-foreground">{i.title}</td>
                  <td className="px-3 py-2">
                    <StateStepper
                      steps={SCHEDULE_STATE_STEPS}
                      value={i.scheduleState as ScheduleState}
                      canEdit={false}
                      ariaLabel="Schedule state"
                    />
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
          <SearchableSelect
            variant="field"
            value={target}
            ariaLabel={t('rollover.destination')}
            placeholder="Backlog (no iteration)"
            options={[
              { value: '', label: 'Backlog (no iteration)' },
              ...targets.map((it) => ({ value: it.id, label: it.name })),
            ]}
            onChange={setTarget}
          />
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
