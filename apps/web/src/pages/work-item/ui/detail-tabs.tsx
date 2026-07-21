import { useNavigate } from '@tanstack/react-router'
import { Bug } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { useActivityLog, useChildDefects, type WorkItem } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { describeActivity } from '@/entities/work-item/model/activity'
import { formatDateTime } from '@/shared/lib/utils'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { OwnerCell, OwnerAvatar } from '@/shared/ui/owner-cell'
import { ScheduleStateBadge, PriorityBadge, SeverityBadge } from '@/entities/work-item/ui/badges'
import { Spinner } from '@/shared/ui/spinner'

export function HistoryTab({ workItemId }: { workItemId: string }) {
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
        <h2 className="text-[20px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Revision History
        </h2>
        <p className="mt-1 text-[12px]" style={{ color: BRAND.textSecondary }}>
          Activity log for field changes, task updates, and work item creation.
        </p>
      </div>

      <section
        className="overflow-hidden rounded bg-white"
        style={{ border: `1px solid ${BRAND.border}` }}
      >
        <div
          className="grid px-4 py-2 text-[10px] font-semibold tracking-wider uppercase"
          style={{
            gridTemplateColumns: GRID,
            color: BRAND.textSecondary,
            backgroundColor: BRAND.surfaceHover,
            borderBottom: `1px solid ${BRAND.border}`,
          }}
        >
          <span>Revision</span>
          <span>Description</span>
          <span>Creation Date</span>
          <span>User</span>
        </div>

        {logs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: BRAND.textMuted }}>
            No activity recorded yet.
          </div>
        )}

        {logs.map((log, i) => {
          const revision = logs.length - i
          const userName = log.actorName ?? log.actorId ?? 'System'
          return (
            <div
              key={log.id}
              className="grid items-start px-4 py-3 text-[12px]"
              style={{
                gridTemplateColumns: GRID,
                borderBottom: `1px solid ${BRAND.borderInner}`,
                color: BRAND.textPrimary,
              }}
            >
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{ color: BRAND.primaryLight }}
              >
                {revision}
              </span>
              <span style={{ color: BRAND.textPrimary }}>{describeActivity(log)}</span>
              <span className="font-mono text-[11px]" style={{ color: BRAND.textSecondary }}>
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
          <h2 className="text-[20px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Defects
          </h2>
          <p className="mt-0.5 text-[12px]" style={{ color: BRAND.textSecondary }}>
            {defects.length} defect{defects.length !== 1 ? 's' : ''} linked to this story
          </p>
        </div>
      </div>

      {defects.length === 0 ? (
        <div
          className="rounded py-12 text-center"
          style={{ border: `1px dashed ${BRAND.borderInput}` }}
        >
          <Bug size={28} style={{ color: BRAND.textFaint, margin: '0 auto 8px' }} />
          <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
            No defects linked to this story
          </p>
          <p className="mt-1 text-[11px]" style={{ color: BRAND.textMuted }}>
            Create a defect and assign it as a child of this story
          </p>
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded"
          style={{ border: `1px solid ${BRAND.borderInput}` }}
        >
          <div className="min-w-[600px]">
            {/* Header */}
            <div
              className="grid items-center bg-surface-hover px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase"
              style={{
                gridTemplateColumns: DEFECT_GRID,
                color: BRAND.textSecondary,
                borderBottom: `1px solid ${BRAND.borderInput}`,
              }}
            >
              {DEFECT_COLS.map((col) => (
                <span key={col}>{col}</span>
              ))}
            </div>
            {/* Rows */}
            {defects.map((d) => (
              <div
                key={d.id}
                className="grid cursor-pointer items-center px-3 py-2 text-[12px] transition-colors hover:bg-primary-lighter"
                style={{
                  gridTemplateColumns: DEFECT_GRID,
                  borderBottom: `1px solid ${BRAND.borderInner}`,
                }}
                onClick={() => openDefect(d)}
              >
                <span className="flex items-center overflow-hidden">
                  <IdCell type={d.type} itemKey={d.itemKey} onOpen={() => openDefect(d)} />
                </span>
                <span className="truncate font-medium" style={{ color: BRAND.textPrimary }}>
                  {d.title}
                </span>
                <ScheduleStateBadge state={d.scheduleState} />
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
