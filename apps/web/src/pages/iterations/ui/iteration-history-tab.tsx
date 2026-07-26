/**
 * IterationHistoryTab — the Iteration (Timebox) detail "Revision History" tab.
 * Thin wrapper over the shared <ActivityHistoryTab> so every entity detail page
 * renders an identical revision feed; only the data hook + copy differ.
 */
import { useTranslation } from 'react-i18next'

import { useIterationActivityLog } from '@/features/iterations/api'
import { ActivityHistoryTab } from '@/entities/activity/ui/activity-history-tab'

export function IterationHistoryTab({ iterationId }: { iterationId: string }) {
  const { t } = useTranslation('iterations')
  const { data: logs = [], isLoading } = useIterationActivityLog(iterationId)
  return (
    <ActivityHistoryTab
      logs={logs}
      isLoading={isLoading}
      title={t('detail.historyTitle', 'Revision History')}
      subtitle={t('detail.historySubtitle', 'Every change to this iteration, newest first.')}
    />
  )
}
