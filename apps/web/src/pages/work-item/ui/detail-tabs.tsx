/**
 * The Work Item detail tabs that are not big enough to own a file.
 *
 * This also HELD a `DefectsTab`, removed under `GAP-P1-WID-001` — see the tab-bar docblock in
 * `work-item-detail-page.tsx` for the BA audit that asked for it.
 */
import { useTranslation } from 'react-i18next'

import { useActivityLog } from '@/features/work-items/api'
import { ActivityHistoryTab } from '@/entities/activity/ui/activity-history-tab'
import { listResource } from '@/shared/lib/query/resource'

export function HistoryTab({ workItemId }: { workItemId: string }) {
  const { t } = useTranslation('work-items')
  const activityQuery = useActivityLog(workItemId)
  const logs = listResource(activityQuery)
  return (
    <ActivityHistoryTab logs={logs} title={t('tabs.history')} subtitle={t('history.subtitle')} />
  )
}
