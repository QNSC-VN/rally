/**
 * Portfolio — the Initiative → Feature → Story rollup tree for the current
 * project scope.
 *
 * Built entirely on the existing work-item hierarchy (no portfolio backend):
 * `usePortfolio` reads the three levels and rolls up progress / points /
 * blocked counts bottom-up. Reuses the shared work-item primitives (TypeBadge,
 * ScheduleStateBadge, OwnerCell, MetricCard) so the portfolio can never drift
 * from the rest of the app.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, AlertTriangle, Plus, Loader2 } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { formatDate } from '@/shared/lib/utils'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useProjectMembers } from '@/features/teams/api'
import { useReleases } from '@/features/releases/api'
import { useCreateWorkItem } from '@/features/work-items/api'
import { usePortfolio, portfolioKeys, type PortfolioNode } from '@/features/portfolio/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import type { ScheduleState } from '@/entities/work-item/model/types'
import { WORK_ITEM_TYPE_CONFIG, type WorkItemType } from '@/entities/work-item/model/types'
import { OwnerCell, ownerSelectOptions } from '@/shared/ui/owner-cell'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { ViewOnlyBadge } from '@/shared/ui/view-only-badge'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'

const COLS = {
  id: 'w-52 shrink-0',
  type: 'w-24 shrink-0',
  name: 'min-w-0 flex-1 pr-3',
  owner: 'w-32 shrink-0',
  status: 'w-28 shrink-0',
  progress: 'w-40 shrink-0',
  release: 'w-28 shrink-0',
  related: 'w-16 shrink-0 text-center',
  blocked: 'w-16 shrink-0 text-center',
  updated: 'w-24 shrink-0',
} as const

function progressColor(pct: number): string {
  if (pct >= 100) return BRAND.success
  if (pct > 50) return BRAND.primaryLight
  return BRAND.warning
}

export function PortfolioPage() {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const { project, team } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canCreate = can('work_item:create')

  const { data, isLoading, isError } = usePortfolio(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const { data: releases = [] } = useReleases(projectId)

  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])
  const releaseMap = useMemo(() => new Map(releases.map((r) => [r.id, r.name])), [releases])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)

  // Default-expand every initiative on first load so the portfolio opens with
  // its features visible (mirrors the BA mockup).
  const [seeded, setSeeded] = useState(false)
  const tree = data?.tree ?? []
  if (!seeded && tree.length > 0) {
    setExpanded(new Set(tree.map((n) => n.item.id)))
    setSeeded(true)
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-foreground-subtle">
        <p className="text-sm">{t('selectProject')}</p>
      </div>
    )
  }

  const metrics = data?.metrics

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Metric strip ─────────────────────────────────────────────────── */}
      <MetricStrip>
        <MetricCard
          label={t('metrics.initiatives')}
          value={metrics?.initiatives ?? 0}
          minWidth={90}
        />
        <MetricCard label={t('metrics.features')} value={metrics?.features ?? 0} minWidth={90} />
        <MetricCard
          label={t('metrics.totalStories')}
          value={metrics?.totalStories ?? 0}
          minWidth={100}
        />
        <MetricCard
          label={t('metrics.acceptedStories')}
          value={metrics?.acceptedStories ?? 0}
          valueColor={BRAND.success}
          minWidth={120}
        />
        <MetricCard
          label={t('metrics.totalPoints')}
          value={metrics?.totalPoints ?? 0}
          valueColor={BRAND.primaryLight}
          minWidth={100}
        />
      </MetricStrip>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 border-b border-border-strong bg-card px-4"
        style={{ height: 44 }}
      >
        <h2 className="text-ui-lg font-semibold text-foreground">{t('title')}</h2>
        <span className="text-ui-md text-muted-foreground">
          {project.projectName}
          {team ? ` · ${team.teamName}` : ''}
        </span>
        {!canCreate && <ViewOnlyBadge />}
        {canCreate && (
          <Button size="sm" type="button" className="ml-auto" onClick={() => setShowCreate(true)}>
            <Plus size={13} /> {t('newInitiative')}
          </Button>
        )}
      </div>

      {/* ── Tree ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto bg-card">
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={8} cols={7} />
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center text-ui-lg text-destructive">
            {t('loadError')}
          </div>
        ) : tree.length === 0 ? (
          <div className="flex h-full items-center justify-center text-ui-lg text-foreground-subtle">
            {t('empty')}
          </div>
        ) : (
          <>
            {/* Column header */}
            <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border-strong bg-surface-hover px-3">
              {(
                [
                  [COLS.id, t('columns.id')],
                  [COLS.type, t('columns.type')],
                  [COLS.name, t('common:name')],
                  [COLS.owner, t('common:owner')],
                  [COLS.status, t('common:status')],
                  [COLS.progress, t('columns.progress')],
                  [COLS.release, t('columns.targetRelease')],
                  [COLS.related, t('columns.related')],
                  [COLS.blocked, t('columns.blocked')],
                  [COLS.updated, t('common:updatedAt')],
                ] as const
              ).map(([cls, label]) => (
                <div
                  key={label}
                  className={`${cls} text-ui-2xs font-semibold tracking-wider text-foreground-subtle uppercase`}
                >
                  {label}
                </div>
              ))}
            </div>

            {tree.map((node) => (
              <TreeRow
                key={node.item.id}
                node={node}
                level={0}
                expanded={expanded}
                onToggle={toggle}
                memberMap={memberMap}
                releaseMap={releaseMap}
                onOpen={(itemKey) => void navigate({ to: '/item/$itemKey', params: { itemKey } })}
              />
            ))}
          </>
        )}
      </div>

      {showCreate && (
        <CreateInitiativeModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          members={members}
        />
      )}
    </div>
  )
}

// ── Recursive row ────────────────────────────────────────────────────────────

function TreeRow({
  node,
  level,
  expanded,
  onToggle,
  memberMap,
  releaseMap,
  onOpen,
}: {
  node: PortfolioNode
  level: number
  expanded: Set<string>
  onToggle: (id: string) => void
  memberMap: Map<string, { displayName?: string | null; email?: string | null }>
  releaseMap: Map<string, string>
  onOpen: (itemKey: string) => void
}) {
  const { item, children, rollup } = node
  const hasChildren = children.length > 0
  const isOpen = expanded.has(item.id)
  const isStory = level === 2
  const owner = item.assigneeId ? memberMap.get(item.assigneeId) : undefined
  const ownerName = owner?.displayName ?? owner?.email ?? null
  const typeCfg = WORK_ITEM_TYPE_CONFIG[item.type as WorkItemType]
  const related = isStory ? null : children.length
  const progressLabel = isStory
    ? `${rollup.progressPct}%`
    : `${rollup.progressPct}% (${rollup.acceptedStories}/${rollup.totalStories})`

  return (
    <div>
      <div
        className="flex min-h-9 items-center gap-2 border-b border-border-subtle bg-card px-3 hover:bg-surface-hover"
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={hasChildren ? () => onToggle(item.id) : undefined}
      >
        <div className={`${COLS.id} flex items-center gap-1.5`} style={{ paddingLeft: level * 20 }}>
          <span className="flex w-3.5 justify-center">
            {hasChildren &&
              (isOpen ? (
                <ChevronDown size={12} className="text-foreground-subtle" />
              ) : (
                <ChevronRight size={12} className="text-foreground-subtle" />
              ))}
          </span>
          <IdCell type={item.type} itemKey={item.itemKey} onOpen={() => onOpen(item.itemKey)} />
        </div>

        <div className={COLS.type}>
          <span
            className="inline-flex items-center rounded-sm px-1.5 py-px text-ui-xs font-semibold whitespace-nowrap"
            style={{ backgroundColor: typeCfg?.bg, color: typeCfg?.color }}
          >
            {typeCfg?.label ?? item.type}
          </span>
        </div>

        <div className={COLS.name}>
          <span
            className="block break-words whitespace-normal text-ui-md text-foreground"
            style={{ fontWeight: level === 0 ? 600 : level === 1 ? 500 : 400 }}
            title={item.title}
          >
            {item.title}
          </span>
        </div>

        <div className={COLS.owner}>
          <OwnerCell name={ownerName} />
        </div>

        <div className={COLS.status}>
          <StateStepper
            steps={SCHEDULE_STATE_STEPS}
            value={item.scheduleState as ScheduleState}
            canEdit={false}
            ariaLabel="Schedule state"
          />
        </div>

        <div className={`${COLS.progress} flex items-center gap-2`}>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border-subtle">
            <div
              className="h-full rounded-full"
              style={{
                width: `${rollup.progressPct}%`,
                backgroundColor: progressColor(rollup.progressPct),
              }}
            />
          </div>
          <span className="text-ui-xs text-muted-foreground tabular-nums">{progressLabel}</span>
        </div>

        <div className={`${COLS.release} truncate text-ui-sm text-muted-foreground`}>
          {item.releaseId ? (releaseMap.get(item.releaseId) ?? '—') : '—'}
        </div>

        <div className={`${COLS.related} text-ui-sm text-muted-foreground tabular-nums`}>
          {related ?? '—'}
        </div>

        <div className={COLS.blocked}>
          {rollup.blockedCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-ui-xs font-semibold text-destructive">
              <AlertTriangle size={10} />
              {rollup.blockedCount}
            </span>
          ) : (
            <span className="text-ui-xs text-foreground-faint">—</span>
          )}
        </div>

        <div className={`${COLS.updated} text-ui-xs text-foreground-subtle`}>
          {formatDate(item.updatedAt)}
        </div>
      </div>

      {isOpen &&
        children.map((child) => (
          <TreeRow
            key={child.item.id}
            node={child}
            level={level + 1}
            expanded={expanded}
            onToggle={onToggle}
            memberMap={memberMap}
            releaseMap={releaseMap}
            onOpen={onOpen}
          />
        ))}
    </div>
  )
}

// ── Create Initiative modal ──────────────────────────────────────────────────

function CreateInitiativeModal({
  projectId,
  members,
  onClose,
}: {
  projectId: string
  members: Array<{ userId: string; displayName?: string | null; email?: string | null }>
  onClose: () => void
}) {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const create = useCreateWorkItem()
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<'none' | 'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [error, setError] = useState<string | null>(null)

  async function submit(openDetail = false) {
    setError(null)
    if (!title.trim()) {
      setError(t('create.titleRequired'))
      return
    }
    try {
      const item = await create.mutateAsync({
        projectId,
        type: 'initiative',
        title: title.trim(),
        priority,
        assigneeId: assigneeId || undefined,
      })
      void qc.invalidateQueries({ queryKey: portfolioKeys.all })
      toast.success(t('create.created', { name: title.trim() }))
      if (openDetail) void navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
      else onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('create.createFailed')
      setError(msg)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('create.title')} width={460}>
      <ModalBody className="space-y-4">
        <FormField label={t('create.titleLabel')} required error={error ?? undefined}>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter the initiative title..."
          />
        </FormField>

        <FormField label={t('common:owner')}>
          <SearchableSelect
            variant="field"
            value={assigneeId}
            ariaLabel={t('common:owner')}
            placeholder={t('create.unassigned')}
            options={ownerSelectOptions(members, assigneeId)}
            onChange={setAssigneeId}
          />
        </FormField>

        <FormField label={t('create.priorityLabel')}>
          <SearchableSelect
            variant="field"
            value={priority}
            ariaLabel={t('create.priorityLabel')}
            options={[
              { value: 'none', label: t('create.priority.none') },
              { value: 'low', label: t('create.priority.low') },
              { value: 'normal', label: t('create.priority.normal') },
              { value: 'high', label: t('create.priority.high') },
              { value: 'urgent', label: t('create.priority.urgent') },
            ]}
            onChange={(v) => setPriority(v as typeof priority)}
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
          {t('create.createWithDetails')}
        </Button>
        <Button type="button" disabled={create.isPending} onClick={() => submit(false)}>
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('create.createButton')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
