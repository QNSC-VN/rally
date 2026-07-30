import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import {
  useForecastCapacity,
  useSetCapacity,
  type CapacityForecast,
  type CapacityForecastComplexity,
  type CapacityPlanTeam,
} from '@/features/capacity-planning/api'

/** Rally's five complexity options, in its own order from easiest to least understood. */
const COMPLEXITIES: CapacityForecastComplexity[] = [
  'well_understood',
  'typical',
  'minor_concerns',
  'major_concerns',
  'many_unknowns',
]

/**
 * Rally's Calculate Capacity Forecast, for one team.
 *
 * Three numbers, not one. Rally reports what the team delivers 85% of the time (Min), 50%
 * (Median) and 15% (Max), and each is a *choice*: committing to the Median means missing
 * half the time. A single suggested number would hide whether the team is steady or erratic,
 * which is the only reason to sample history instead of averaging it.
 *
 * Nothing is written until a line is picked. Being shown a forecast is not the same act as
 * adopting it, so each figure has its own "Use" button that commits through the ordinary
 * capacity mutation — the same path, and the same permission, as typing the number by hand.
 */
export function CapacityForecastModal({
  planId,
  team,
  unitLabel,
  canManage,
  onClose,
}: {
  planId: string
  team: CapacityPlanTeam
  unitLabel: string
  /** A published plan is read-only: the forecast still calculates, but nothing may be set. */
  canManage: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const run = useForecastCapacity()
  const setCapacity = useSetCapacity()

  const [availability, setAvailability] = useState('100')
  const [complexity, setComplexity] = useState<CapacityForecastComplexity>('typical')
  const [result, setResult] = useState<CapacityForecast | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function calculate() {
    const parsed = Number(availability.trim())
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
      setError(t('forecast.availabilityInvalid'))
      return
    }
    setError(null)
    try {
      setResult(
        await run.mutateAsync({
          id: planId,
          teamId: team.teamId,
          availabilityPct: Math.round(parsed),
          complexity,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t('forecast.failed'))
    }
  }

  async function use(value: number) {
    try {
      await setCapacity.mutateAsync({ id: planId, teamId: team.teamId, capacity: value })
      notify.success(t('row.capacityUpdated'))
      onClose()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('forecast.failed'))
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('forecast.title')}
      subtitle={t('forecast.subtitle', { team: team.teamName ?? '—' })}
      width={520}
    >
      <ModalBody className="space-y-4">
        {error && (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        )}

        <FormField label={t('forecast.availabilityLabel')} htmlFor="forecast-availability">
          <Input
            id="forecast-availability"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            inputMode="numeric"
          />
        </FormField>
        {/* Rally's own guidance: 100 for a stable team, 200 if it doubled, 50 if halved. */}
        <p className="text-ui-xs text-foreground-subtle">{t('forecast.availabilityHint')}</p>

        <FormField label={t('forecast.complexityLabel')}>
          <SearchableSelect
            variant="field"
            value={complexity}
            ariaLabel={t('forecast.complexityLabel')}
            options={COMPLEXITIES.map((value) => ({
              value,
              label: t(`forecast.complexity.${value}`),
            }))}
            onChange={(v) => setComplexity((v as CapacityForecastComplexity | null) ?? 'typical')}
          />
        </FormField>

        <Button type="button" size="sm" onClick={() => void calculate()} disabled={run.isPending}>
          {run.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('forecast.calculate')}
        </Button>

        {result !== null && (
          <div className="border-t border-border-inner pt-3">
            {result.insufficientData !== null ? (
              <>
                {/* Named, not generic: "wait a sprint" and "enter the plan's dates" are
                    different actions, and only the reason tells the planner which. */}
                <p role="status" className="text-ui-sm text-foreground">
                  {t(`forecast.insufficient.${result.insufficientData}`)}
                </p>
                <p className="mt-1 text-ui-xs text-foreground-subtle">
                  {t('forecast.historySummary', {
                    iterations: result.samplesUsed,
                    days: result.historyDays,
                  })}
                </p>
              </>
            ) : (
              <>
                <p className="text-ui-xs text-foreground-subtle">
                  {t('forecast.basis', {
                    iterations: result.samplesUsed,
                    days: result.historyDays,
                    modelled: result.iterationsModelled,
                  })}
                </p>
                <table className="mt-2 w-full text-ui-sm tabular-nums">
                  <tbody>
                    {(
                      [
                        ['min', result.min],
                        ['median', result.median],
                        ['max', result.max],
                      ] as const
                    ).map(([line, value]) => (
                      <tr key={line} className="border-b border-border-inner">
                        <th scope="row" className="py-1 pr-2 text-left font-normal text-foreground">
                          {t(`forecast.lines.${line}`)}
                        </th>
                        <td className="px-2 py-1 text-right font-semibold">
                          {value} <span className="font-normal">{unitLabel}</span>
                        </td>
                        <td className="w-24 py-1 pl-2 text-right">
                          {canManage && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={setCapacity.isPending}
                              onClick={() => void use(value)}
                            >
                              {t('forecast.use')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
