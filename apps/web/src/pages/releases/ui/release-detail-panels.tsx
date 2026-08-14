import { useTranslation } from 'react-i18next'

import { EMPTY_VALUE } from '@/shared/lib/utils'
import { type Release } from '@/features/releases/api'

type Rollup = NonNullable<Release['taskRollup']>

/**
 * Hours, or `--` when the number is genuinely absent. Never a coerced `0`: that would state
 * that nothing is estimated/remaining/logged, which is a different claim from "we do not know".
 */
function formatHours(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY_VALUE : `${value}h`
}

/**
 * Read-only Task Roll-up + Accepted — the two metric fields P3-REL-FR-018 puts in the Release
 * detail's right panel.
 *
 * Task Roll-up is Estimate / To Do / Actual **hours** from the assigned tasks (FR-023). It is
 * deliberately NOT a completion percentage: P3-REL-FR-037 says "Phase 3 Release list/detail must
 * not add a Release Progress column/widget; progress/tracking belongs to
 * `Portfolio > Release Tracking`", and §7.5 defers the release progress percentage, its
 * zero-state, its formula and its recalculation out of Phase 3.2. A percentage bar and a
 * Date/Total/Done/Remaining burndown table both used to live here, duplicating the deferred
 * Phase 6 surface — and the three hour values the BA actually asks for were nowhere on a release.
 */
export function TaskRollupPanel({ rollup }: { rollup: Rollup }) {
  const { t } = useTranslation('releases')
  return (
    <div className="space-y-3 rounded-md border border-border-subtle bg-surface-hover p-3">
      <h3 className="text-ui-xs font-bold tracking-wider text-muted-foreground uppercase">
        {t('detailPage.rollup.title')}
      </h3>

      <div className="grid grid-cols-3 gap-1 text-center">
        <div className="rounded-sm bg-primary-lighter py-1.5">
          <div className="text-ui-2xs font-semibold tracking-wider text-primary uppercase">
            {t('detailPage.rollup.estimate')}
          </div>
          <div className="font-mono text-ui-xl font-bold text-foreground">
            {formatHours(rollup.estimateHours)}
          </div>
        </div>
        <div className="rounded-sm bg-warning-bg py-1.5">
          <div className="text-ui-2xs font-semibold tracking-wider text-warning uppercase">
            {t('detailPage.rollup.toDo')}
          </div>
          <div className="font-mono text-ui-xl font-bold text-foreground">
            {formatHours(rollup.toDoHours)}
          </div>
        </div>
        <div className="rounded-sm bg-success-bg py-1.5">
          <div className="text-ui-2xs font-semibold tracking-wider text-success uppercase">
            {t('detailPage.rollup.actual')}
          </div>
          <div className="font-mono text-ui-xl font-bold text-foreground">
            {formatHours(rollup.actualHours)}
          </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between rounded-sm border border-success-border bg-success-bg px-3 py-2">
        <span className="text-ui-xs font-semibold tracking-wider text-success uppercase">
          {t('detailPage.rollup.accepted')}
        </span>
        <span className="font-mono text-ui-xl font-bold text-success">{rollup.acceptedItems}</span>
      </div>
    </div>
  )
}
