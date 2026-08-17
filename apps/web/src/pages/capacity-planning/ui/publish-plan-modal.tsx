import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { notify } from '@/shared/lib/toast'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { useReleaseOptions } from '@/features/releases/api'
import {
  usePublishPlan,
  type CapacityPlan,
  type PublishSkip,
} from '@/features/capacity-planning/api'

/**
 * Rally's two publish buttons, and the report that comes back.
 *
 * Publishing is the one action in Phase 5 that writes OUTSIDE the plan — it stamps the plan's
 * Release and planned dates onto every assigned Feature — so it is confirmed rather than
 * one-click, and the dialog says exactly which fields it will touch before it touches them.
 *
 * "Publish without updating fields" is Rally's own second option, not a softener invented
 * here: a plan can be published purely for visibility, leaving every Feature alone.
 *
 * The result is shown IN PLACE rather than as a toast. A publish that wrote 3 of 5 Features
 * succeeded, and a toast cannot carry the list of which two did not take the Release and why —
 * the planner has to read that and go fix those rows.
 */
export function PublishPlanModal({ plan, onClose }: { plan: CapacityPlan; onClose: () => void }) {
  const { t } = useTranslation('capacity')
  const publish = usePublishPlan()

  const [result, setResult] = useState<{ featuresUpdated: number; skipped: PublishSkip[] } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  /**
   * A plan has a window only when BOTH dates are set — the same rule the server's `planWindow`
   * applies, and the reason this is checked here at all: with no window `Publish and update fields`
   * writes nothing to any Feature (AC-019 refuses the Release field too), so the planner is told
   * BEFORE the click rather than reading a list of `no_window` skips afterwards. Published plans are
   * read-only, so the fix — `Edit Plan Details` — is only reachable by reverting to draft first.
   */
  const hasWindow = Boolean(plan.plannedStartDate && plan.plannedEndDate)

  /**
   * The RELEASE's own window, so a mismatch advisory can print both date pairs side by side.
   *
   * From the release REFERENCE feed, which already carries `startDate`/`releaseDate` and is cached by
   * every other picker on this surface — the publish response deliberately carries only the reason
   * code, and inventing a second server field for two dates the client can already name would be one
   * more number free to disagree with the plan header beside it.
   *
   * The advisory is why the dates matter: AC-019 compares them for EQUALITY, so a plan that ends
   * EARLIER than its release is a mismatch without being outside it. Naming both windows is the only
   * wording that survives that case (`P5-CP-035`).
   */
  const { data: releases = [] } = useReleaseOptions(plan.projectId)
  const release = releases.find((candidate) => candidate.id === plan.releaseId)
  const windowDates = {
    planStart: plan.plannedStartDate ?? EMPTY_VALUE,
    planEnd: plan.plannedEndDate ?? EMPTY_VALUE,
    releaseStart: release?.startDate ?? EMPTY_VALUE,
    releaseEnd: release?.releaseDate ?? EMPTY_VALUE,
  }

  async function run(updateFields: boolean) {
    setError(null)
    try {
      const res = await publish.mutateAsync({ id: plan.id, updateFields })
      // Closes immediately on a clean publish; stays open when there is something to read.
      if (res.skipped.length === 0) {
        notify.success(t('publish.done', { count: res.featuresUpdated }))
        onClose()
        return
      }
      setResult({ featuresUpdated: res.featuresUpdated, skipped: res.skipped })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('publish.failed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('publish.title')} width={540}>
      <ModalBody className="space-y-3">
        {error && (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        )}

        {result === null ? (
          <>
            <p className="text-ui-sm text-foreground">{t('publish.explain')}</p>
            {/* Named up front, because this is the part that cannot be undone by reverting. */}
            <ul className="list-disc space-y-1 pl-5 text-ui-sm text-muted-foreground">
              <li>{t('publish.willWrite')}</li>
              <li>{t('publish.releaseRule')}</li>
              <li>{t('publish.revertWarning')}</li>
            </ul>
            {!hasWindow && <p className="text-ui-sm text-warning">{t('publish.noWindowNote')}</p>}
          </>
        ) : (
          <div role="status" className="space-y-2">
            <p className="text-ui-sm text-foreground">
              {t('publish.done', { count: result.featuresUpdated })}
            </p>
            <p className="text-ui-sm font-medium text-foreground">{t('publish.skippedHeading')}</p>
            {/* Keyed by Feature, which the server guarantees is unique here: a Feature split across
                two teams has two allocation rows and ONE publish decision, so it used to appear twice
                with a duplicate React key as well (`P5-CP-035`). The date pair is passed to every
                reason; only the mismatch one names it. */}
            <ul className="space-y-1 text-ui-sm text-muted-foreground">
              {result.skipped.map((skip) => (
                <li key={skip.portfolioItemId}>
                  <span className="font-medium text-foreground">{skip.itemKey}</span> —{' '}
                  {t(`publish.skipReason.${skip.reason}`, windowDates)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        {result === null ? (
          <>
            <Button variant="outline" type="button" onClick={onClose}>
              {t('common:cancel')}
            </Button>
            {/* Rally's secondary option, kept beside the primary rather than hidden behind a
                checkbox: the two are different acts, not one act with a setting. */}
            <Button
              variant="secondary"
              type="button"
              disabled={publish.isPending}
              onClick={() => void run(false)}
            >
              {t('publish.withoutFields')}
            </Button>
            <Button type="button" disabled={publish.isPending} onClick={() => void run(true)}>
              {publish.isPending && <Loader2 size={11} className="animate-spin" />}
              {t('publish.confirm')}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={onClose}>
            {t('publish.acknowledge')}
          </Button>
        )}
      </ModalFooter>
    </AppModal>
  )
}
