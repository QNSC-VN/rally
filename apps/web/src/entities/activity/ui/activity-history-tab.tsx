/**
 * ActivityHistoryTab — the shared "Revision History" table for EVERY entity
 * detail page (work item, iteration, project, milestone, release). A newest-first
 * grid (Revision # / Description / Creation Date / User). Each detail page passes
 * the logs from its own `useActivityLog`-style hook; humanisation is the single
 * shared `describeActivity`.
 */
import { useTranslation } from 'react-i18next'
import { describeActivity, type ActivityLike } from '@/entities/work-item/model/activity'
import { formatDateTime } from '@/shared/lib/utils'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { Spinner } from '@/shared/ui/spinner'

const GRID = '90px 1fr 190px 170px'

interface ActivityRow extends ActivityLike {
  id: string
  createdAt: string
  actorId: string | null
  actorName: string | null
}

export function ActivityHistoryTab({
  logs,
  isLoading,
  title,
  subtitle,
}: {
  logs: ActivityRow[]
  isLoading: boolean
  title: string
  subtitle: string
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex h-20 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="w-full space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-ui-md text-muted-foreground">{subtitle}</p>
      </div>

      <section className="overflow-hidden rounded border border-border-strong bg-card">
        <div
          className="grid border-b border-border-strong bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wider text-muted-foreground uppercase"
          style={{ gridTemplateColumns: GRID }}
        >
          <span>{t('common:revision', 'Revision')}</span>
          <span>{t('common:description', 'Description')}</span>
          <span>{t('common:creationDate', 'Creation Date')}</span>
          <span>{t('common:user', 'User')}</span>
        </div>

        {logs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-foreground-subtle">
            {t('common:noRevisions', 'No revisions yet.')}
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
              <span className="font-mono text-ui-sm text-primary-light tabular-nums">{revision}</span>
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
