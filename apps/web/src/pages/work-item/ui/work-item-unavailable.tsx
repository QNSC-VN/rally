/**
 * The three ways `/item/$itemKey` can fail to show a record — as three different sentences.
 *
 * WHY THIS EXISTS (GAP-P4-RBAC-003, Fail 3 / AC6)
 * ----------------------------------------------
 * Opening `/item/US-17` with no access to the owning project rendered a BLANK PAGE. It did not leak
 * the record, but it said nothing at all and offered no way out — while `/backlog`, one URL over,
 * renders Access Denied correctly. Phase 4 `02_Roles_Permissions/SRS.md` §7 is explicit: a known
 * route without sufficient permission shows Access Denied, an inaccessible identifier may show Not
 * Found, and neither may disclose the restricted title, owner, Project or Team.
 *
 * The blank page had TWO causes stacked, which is why the route guard alone could not close it:
 *   1. `RequirePermission` resolves `work_item:view` against the SELECTED project. With a stale
 *      persisted selection (see `features/projects/use-initial-project.ts`) that read could itself
 *      403, and the guard renders its children on `isError` — deliberately, because "we could not
 *      ask" is not "you may not". So the page rendered.
 *   2. The page then had no denied state of its own: a thrown `by-key` fetch left `data` as
 *      `undefined`, and the only non-record branch was a "not found" line whose recovery control was
 *      a raw `<button>`.
 * A record route must therefore own this decision. `by-key` carries no `@RequirePermission` by design
 * — item keys are workspace-unique, so the owning project is unknown until the row loads — which
 * makes the page's own response to that route's 403 the only place the refusal can be rendered.
 *
 * THE THREE STATES, and why not one component with a boolean (the mapping itself lives in
 * `../model/unavailable-reason.ts`):
 *   • `denied`     — a 403. The record exists and is not ours. `AccessDenied` (the same node
 *                    `/backlog` shows), so the two routes read identically for one reader.
 *   • `notFound`   — a 404 mapped to `null`. No such key in this workspace. Names the key back,
 *                    which discloses nothing the reader did not type.
 *   • `loadFailed` — a 500 or a transport fault. `LoadErrorState`, because "could not load" is not a
 *                    claim about either the reader or the record.
 * `shared/lib/query/resource.ts` records what collapsing any two of these has cost before.
 */
import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccessDenied } from '@/shared/ui/access-denied'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { LoadErrorState } from '@/shared/ui/load-error-state'
import type { WorkItemUnavailableReason } from '../model/unavailable-reason'

export function WorkItemUnavailable({
  reason,
  itemKey,
  error,
  onBack,
}: {
  reason: WorkItemUnavailableReason
  itemKey: string
  error?: unknown
  /** The recovery action every one of these states must offer — §7's "no way out" half. */
  onBack: () => void
}) {
  const { t } = useTranslation('work-items')

  const back = (
    <Button variant="secondary" size="sm" onClick={onBack}>
      {t('backToBacklog')}
    </Button>
  )

  if (reason === 'denied') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <AccessDenied />
        {back}
      </div>
    )
  }

  if (reason === 'loadFailed') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <LoadErrorState error={error} />
        {back}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <EmptyState
        icon={<SearchX size={28} className="text-foreground-subtle" />}
        title={t('notFound', { key: itemKey })}
        description={t('notFoundHint')}
        action={back}
      />
    </div>
  )
}
