import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Bug } from 'lucide-react'

import { useActivityLog, useChildDefects, type WorkItem } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { describeActivity } from '@/entities/work-item/model/activity'
import { formatDateTime } from '@/shared/lib/utils'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import type { ScheduleState } from '@/entities/work-item/model/types'
import { OwnerCell, OwnerAvatar } from '@/shared/ui/owner-cell'
import { PriorityBadge, SeverityBadge } from '@/entities/work-item/ui/badges'
import { Spinner } from '@/shared/ui/spinner'

export function HistoryTab({ workItemId }: { workItemId: string }) {
  const { t } = useTranslation('work-items')
  const { data: logs = [], isLoading } = useActivityLog(workItemId)

  if (isLoading) {
    return (
      <div className="flex h-20 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const GRID = '90px 1fr 190px 170px'

  return (
    <div className="w-full space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t('tabs.history')}</h2>
        <p className="mt-1 text-ui-md text-muted-foreground">{t('history.subtitle')}</p>
      </div>

      <section className="overflow-hidden rounded border border-border-strong bg-card">
        <div
          className="grid border-b border-border-strong bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wider text-muted-foreground uppercase"
          style={{ gridTemplateColumns: GRID }}
        >
          <span>{t('history.colRevision')}</span>
          <span>{t('common:description')}</span>
          <span>{t('history.colCreationDate')}</span>
          <span>{t('history.colUser')}</span>
        </div>

        {logs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-foreground-subtle">
            {t('history.empty')}
          </div>
        )}

        {logs.map((log, i) => {
          const revision = logs.length - i
          const userName = log.actorName ?? log.actorId ?? 'System'
          return (
            <div
              key={log.id}
              className="grid items-start border-b border-border-inner px-4 py-3 text-ui-md text-foreground"
              style={{ gridTemplateColumns: GRID }}
            >
              <span className="font-mono text-ui-sm text-primary-light tabular-nums">
                {revision}
              </span>
              <span className="text-foreground">{describeActivity(log)}</span>
              <span className="font-mono text-ui-sm text-muted-foreground">
                {formatDateTime(log.createdAt)}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <OwnerAvatar name={userName} />
                <span className="truncate">{userName}</span>
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}

// ── Defects tab (child defects of a story) ─────────────────────────────────

const DEFECT_COLS = ['ID', 'Title', 'State', 'Priority', 'Owner', 'Severity']
const DEFECT_GRID = '80px 1fr 120px 80px 130px 100px'

export function DefectsTab({ workItemId, projectId }: { workItemId: string; projectId: string }) {
  const { t } = useTranslation('work-items')
  const { data: defects = [], isLoading } = useChildDefects(workItemId, projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const navigate = useNavigate()

  const ownerName = (id?: string | null) =>
    id ? (members.find((m) => m.userId === id)?.displayName ?? '—') : '—'

  function openDefect(d: WorkItem) {
    void navigate({ to: '/item/$itemKey', params: { itemKey: d.itemKey } })
  }

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('tabs.defects')}</h2>
          <p className="mt-0.5 text-ui-md text-muted-foreground">
            {t('defects.countLinked', { count: defects.length })}
          </p>
        </div>
      </div>

      {defects.length === 0 ? (
        <div className="rounded border border-dashed border-input py-12 text-center">
          <Bug size={28} className="text-foreground-faint" style={{ margin: '0 auto 8px' }} />
          <p className="text-ui-lg font-medium text-muted-foreground">{t('defects.emptyTitle')}</p>
          <p className="mt-1 text-ui-sm text-foreground-subtle">{t('defects.emptyDescription')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-input">
          <div className="min-w-[600px]">
            {/* Header */}
            <div
              className="grid items-center border-b border-input bg-surface-hover px-3 py-1.5 text-ui-xs font-semibold tracking-wider text-muted-foreground uppercase"
              style={{ gridTemplateColumns: DEFECT_GRID }}
            >
              {DEFECT_COLS.map((col) => (
                <span key={col}>{col}</span>
              ))}
            </div>
            {/* Rows */}
            {defects.map((d) => (
              <div
                key={d.id}
                className="grid items-center border-b border-border-inner px-3 py-2 text-ui-md transition-colors hover:bg-primary-lighter"
                style={{ gridTemplateColumns: DEFECT_GRID }}
              >
                <span className="flex items-center overflow-hidden">
                  <IdCell type={d.type} itemKey={d.itemKey} onOpen={() => openDefect(d)} />
                </span>
                <span className="truncate font-medium text-foreground">{d.title}</span>
                <StateStepper
                  steps={SCHEDULE_STATE_STEPS}
                  value={d.scheduleState as ScheduleState}
                  canEdit={false}
                  ariaLabel="Schedule state"
                />
                <span>
                  <PriorityBadge priority={d.priority} />
                </span>
                <span className="flex items-center overflow-hidden">
                  <OwnerCell name={d.assigneeId ? ownerName(d.assigneeId) : null} />
                </span>
                <span>
                  <SeverityBadge severity={(d as unknown as { severity?: string }).severity} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
