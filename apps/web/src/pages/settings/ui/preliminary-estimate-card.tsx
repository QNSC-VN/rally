import { useTranslation } from 'react-i18next'

import { Card, CardBody, CardHeader } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import type { PreliminaryEstimateMap, PreliminaryEstimateSize } from '@/features/workspaces/api'

/** The sizes, in scale order. Not alphabetical — XS…XL only reads correctly ascending. */
const SIZE_ORDER: PreliminaryEstimateSize[] = ['no_entry', 'xs', 's', 'm', 'l', 'xl']

/**
 * Workspace mapping of T-shirt size → points / item count.
 *
 * This is the denominator behind both `Estimated Progress` meters on every Epic and Feature,
 * and the Preliminary tier of a capacity plan. It was always a `workspace_settings` column and
 * always read from there, but nothing could WRITE it — so it was configurable in the schema and
 * hard-coded in practice, and the BA spec's note that the seeded values are "temporary mockup
 * data… do not treat as hard-coded product rules" had no way to be acted on.
 *
 * Rally puts the same thing under Setup → Workspaces & Projects → Fields → Portfolio Item →
 * Preliminary Estimate, where an admin may "add, modify, or delete preliminary estimate sizes
 * and their associated numeric values. Values must be whole numbers."
 *
 * Two parts of Rally's version are deliberately NOT here rather than half-built:
 *   • ADDING or DELETING sizes — ours are a Postgres enum (`preliminary_estimate_size`), so the
 *     set is fixed until that becomes a table.
 *   • The per-size `Enabled` flag Rally uses to retire a size without losing history — no BA
 *     requirement asks for it, and a disabled size would have to be filtered out of every
 *     picker to mean anything.
 */
export function PreliminaryEstimateCard({
  value,
  onChange,
  disabled = false,
}: {
  value: PreliminaryEstimateMap
  onChange: (next: PreliminaryEstimateMap) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('settings')

  const set = (size: PreliminaryEstimateSize, field: 'points' | 'count', raw: string) => {
    // Blank reads as 0, and negatives are refused: these are denominators, and the API rejects
    // them too (`z.number().int().min(0)`), so catching it here saves a round trip.
    const n = Math.max(0, Math.trunc(Number(raw || 0)))
    if (!Number.isFinite(n)) return
    onChange({ ...value, [size]: { ...value[size], [field]: n } })
  }

  return (
    <Card>
      <CardHeader title={t('workspace.sectionPreliminaryEstimate')} />
      <CardBody>
        <p className="mb-3 text-ui-sm text-foreground-subtle">
          {t('workspace.preliminaryEstimateHint')}
        </p>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-inner text-ui-2xs font-semibold tracking-wider text-foreground-subtle uppercase">
              <th className="pb-2 text-left">{t('workspace.estimateSize')}</th>
              <th className="pb-2 text-right">{t('workspace.estimatePoints')}</th>
              <th className="pb-2 text-right">{t('workspace.estimateCount')}</th>
            </tr>
          </thead>
          <tbody>
            {SIZE_ORDER.map((size) => (
              <tr key={size} className="border-b border-border-inner last:border-0">
                <td className="py-2 text-ui-md text-foreground">
                  {t(`workspace.estimateSizes.${size}`)}
                </td>
                <td className="w-28 py-2 pl-3">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    readOnly={disabled}
                    value={String(value[size]?.points ?? 0)}
                    aria-label={t('workspace.estimatePointsFor', {
                      size: t(`workspace.estimateSizes.${size}`),
                    })}
                    onChange={(e) => set(size, 'points', e.target.value)}
                  />
                </td>
                <td className="w-28 py-2 pl-3">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    readOnly={disabled}
                    value={String(value[size]?.count ?? 0)}
                    aria-label={t('workspace.estimateCountFor', {
                      size: t(`workspace.estimateSizes.${size}`),
                    })}
                    onChange={(e) => set(size, 'count', e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Why `No Entry` is 0 and must stay 0 — otherwise an unsized item silently acquires a
            forecast, and its Estimated Progress meter stops being blank. */}
        <p className="mt-3 text-ui-sm text-foreground-subtle">
          {t('workspace.estimateNoEntryNote')}
        </p>
      </CardBody>
    </Card>
  )
}
