import { TrendingDown } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { Spinner } from '@/shared/ui/spinner'
import { type Release } from '@/features/releases/api'

type Rollup = NonNullable<Release['taskRollup']>
type BurndownPoint = {
  date: string
  totalPoints: number
  completedPoints: number
  remainingPoints: number
}

/** Read-only Task Roll-up metrics (completion bar + Estimate/To Do/Actual + Accepted). */
export function TaskRollupPanel({ rollup }: { rollup: Rollup }) {
  return (
    <div className="space-y-3 rounded-md border border-border-subtle bg-surface-hover p-3">
      <h3 className="text-ui-xs font-bold tracking-wider text-muted-foreground uppercase">
        Task Roll-up
      </h3>

      <div className="space-y-1">
        <div className="flex justify-between text-ui-sm font-semibold text-foreground">
          <span>Completion</span>
          <span>{rollup.progressPercent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-avatar">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${rollup.progressPercent}%`,
              backgroundColor: rollup.progressPercent === 100 ? BRAND.success : BRAND.primaryLight,
            }}
          />
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <div className="grid grid-cols-3 gap-1 text-center">
          <div className="rounded-sm bg-primary-lighter py-1.5">
            <div className="text-ui-2xs font-semibold tracking-wider text-primary uppercase">
              Estimate
            </div>
            <div className="font-mono text-ui-xl font-bold text-foreground">
              {rollup.totalPoints}
            </div>
          </div>
          <div className="rounded-sm bg-warning-bg py-1.5">
            <div className="text-ui-2xs font-semibold tracking-wider text-warning uppercase">
              To Do
            </div>
            <div className="font-mono text-ui-xl font-bold text-foreground">
              {rollup.toDoPoints}
            </div>
          </div>
          <div className="rounded-sm bg-success-bg py-1.5">
            <div className="text-ui-2xs font-semibold tracking-wider text-success uppercase">
              Actual
            </div>
            <div className="font-mono text-ui-xl font-bold text-foreground">
              {rollup.completedPoints}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 pt-1 text-center font-mono text-ui-xs text-foreground-subtle">
          <div>
            Items: <span className="font-semibold text-foreground">{rollup.totalItems}</span>
          </div>
          <div>
            To Do: <span className="font-semibold text-foreground">{rollup.toDoItems}</span>
          </div>
          <div>
            Done: <span className="font-semibold text-foreground">{rollup.completedItems}</span>
          </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between rounded-sm border border-success-border bg-success-bg px-3 py-2">
        <span className="text-ui-xs font-semibold tracking-wider text-success uppercase">
          Accepted
        </span>
        <span className="font-mono text-ui-xl font-bold text-success">{rollup.acceptedItems}</span>
      </div>
    </div>
  )
}

/** Read-only burndown table (Date / Total / Done / Remaining points). */
export function BurndownPanel({
  burndown,
  loading,
}: {
  burndown: BurndownPoint[] | undefined
  loading: boolean
}) {
  return (
    <div className="space-y-3 rounded-md border border-border-subtle bg-surface-hover p-4">
      <h3 className="flex items-center gap-1.5 text-ui-xs font-bold tracking-wider text-muted-foreground uppercase">
        <TrendingDown size={13} />
        Burndown
      </h3>
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner size="sm" />
        </div>
      ) : burndown && burndown.length > 0 ? (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-ui-xs">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-1 pr-2 font-semibold text-muted-foreground">Date</th>
                <th className="py-1 pr-2 text-right font-semibold text-muted-foreground">Total</th>
                <th className="py-1 pr-2 text-right font-semibold text-muted-foreground">Done</th>
                <th className="py-1 text-right font-semibold text-muted-foreground">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {burndown.map((pt) => (
                <tr key={pt.date} className="border-b border-border-subtle">
                  <td className="py-1 pr-2 font-mono text-foreground">{pt.date}</td>
                  <td className="py-1 pr-2 text-right font-mono text-foreground">
                    {pt.totalPoints}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono text-success">
                    {pt.completedPoints}
                  </td>
                  <td className="py-1 text-right font-mono text-foreground">
                    {pt.remainingPoints}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-ui-sm text-foreground-subtle">No burndown data available yet.</p>
      )}
    </div>
  )
}
