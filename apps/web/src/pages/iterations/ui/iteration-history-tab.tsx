/**
 * IterationHistoryTab — the Iteration (Timebox) detail "Revision History" tab.
 *
 * Mirrors the Work Item HistoryTab layout so both detail pages read identically:
 * a newest-first revision table (Revision # / Description / Creation Date /
 * User), fed by the iteration activity log. Reuses the shared `describeActivity`
 * humaniser so field-change phrasing matches the work-item feed exactly.
 */
import { useTranslation } from 'react-i18next'

import { useIterationActivityLog } from '@/features/iterations/api'
import { describeActivity } from '@/entities/work-item/model/activity'
import { formatDateTime } from '@/shared/lib/utils'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { Spinner } from '@/shared/ui/spinner'

const GRID = '90px 1fr 190px 170px'

export function IterationHistoryTab({ iterationId }: { iterationId: string }) {
  const { t } = useTranslation('iterations')
  const { data: logs = [], isLoading } = useIterationActivityLog(iterationId)

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
        <h2 className="text-xl font-semibold text-foreground">
          {t('detail.historyTitle', 'Revision History')}
        </h2>
        <p className="mt-1 text-ui-md text-muted-foreground">
          {t('detail.historySubtitle', 'Every change to this iteration, newest first.')}
        </p>
      </div>

      <section className="overflow-hidden rounded border border-border-strong bg-card">
        <div
          className="grid border-b border-border-strong bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wider text-muted-foreground uppercase"
          style={{ gridTemplateColumns: GRID }}
        >
          <span>{t('detail.historyColRevision', 'Revision')}</span>
          <span>{t('common:description', 'Description')}</span>
          <span>{t('detail.historyColDate', 'Creation Date')}</span>
          <span>{t('detail.historyColUser', 'User')}</span>
        </div>

        {logs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-foreground-subtle">
            {t('detail.historyEmpty', 'No revisions yet.')}
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
