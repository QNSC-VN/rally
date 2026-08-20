/**
 * Timeboxes › Iterations — the iteration RECORD, at its own URL.
 *
 * It used to be page-local state: `iterations-page.tsx` held `detailId` and swapped the whole grid for
 * the detail without touching the URL. Measured in a browser, that is the "back goes Home" report —
 * opening an iteration pushed no history entry, so the browser's Back left `/timeboxes` altogether and
 * landed on whatever preceded it. It also meant an iteration could not be linked, bookmarked or
 * reloaded, and the breadcrumb kept saying `Timeboxes` while a record was on screen.
 *
 * Now it is a record route like `/releases/$releaseId` and `/milestones/$milestoneId` — the shape
 * `ADR-001-entity-surface-pattern.md` prescribes ("the detail surface is a routed page (`/<entity>/$id`),
 * never a modal") and names as the remaining Iterations gap.
 *
 * No deep-link project adopter, deliberately, and this matches `/milestones/$milestoneId`: the
 * iteration feed is project-scoped, so the guard and this page both read the one selected project and
 * are incapable of disagreeing about it.
 */
import { useParams } from '@tanstack/react-router'

import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useDetailBack } from '@/shared/lib/use-detail-back'
import { useProjectPermissions } from '@/features/access/api'
import { IterationDetail } from './ui/iteration-parts'

export function IterationDetailPage() {
  const { iterationId } = useParams({ from: '/auth/timeboxes/$iterationId' })
  const { project } = useAppContext()
  const { can } = useProjectPermissions(project?.projectId)
  // The same three codes the list uses to decide whether its own fields are editable.
  const canManage = can('iteration:create') || can('iteration:edit') || can('iteration:delete')

  return (
    <IterationDetail
      id={iterationId}
      canManage={canManage}
      onBack={useDetailBack({ to: '/timeboxes' })}
    />
  )
}
