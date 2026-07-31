import { type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'

import { useSetCapacity, type CapacityPlanTeam } from '@/features/capacity-planning/api'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { MetricValue } from '@/shared/ui/metric-value'
import { WarningCountBadge } from '@/shared/ui/warning-count-badge'
import { CompositeBar } from '@/shared/ui/composite-bar'
import { IconButton } from '@/shared/ui/icon-button'
import { notify } from '@/shared/lib/toast'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'
import { type TeamColKey } from '../model/columns'

/**
 * One team row inside a capacity plan.
 *
 * The capacity cell edits in place and distinguishes THREE states, which is the whole
 * point of the column:
 *   • blank    — no capacity entered yet (`null`); no warning rule may treat it as a real
 *                ceiling, so it must not render as 0
 *   • 0        — an entered ceiling of zero, i.e. this team is deliberately unavailable
 *   • a number — the ceiling in the plan's unit
 *
 * Clearing the field sends `null` rather than 0, so a planner can undo a value instead of
 * being forced to assert one.
 */
export function CapacityTeamRow({
  planId,
  team,
  unitLabel,
  targetLoadPct,
  canManage,
  colStyleFor,
  gutter,
  onForecast,
  expanded,
  onToggleExpanded,
  featureCount,
}: {
  planId: string
  team: CapacityPlanTeam
  /** "points" / "items" — the plan's fixed unit, shown beside the number. */
  unitLabel: string
  /** Draws the advisory target marker on the bar. */
  targetLoadPct: number
  canManage: boolean
  colStyleFor: (key: TeamColKey, base?: CSSProperties) => CSSProperties
  gutter: ReactNode
  /** Opens the capacity forecast for THIS team; the page owns the modal. */
  onForecast: () => void
  /** Whether this team's allocated Features are shown — Rally collapses them by default. */
  expanded: boolean
  onToggleExpanded: () => void
  /**
   * How many Features are allocated to this team.
   *
   * Shown on the row itself so a COLLAPSED team still says how much it carries. Hiding the
   * children without leaving a count behind would make an empty team and a full one look
   * identical.
   */
  featureCount: number
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()
  const warnings = warningText(team.metrics.warnings)
  /** Share of THIS team's capacity, or null when it has entered none. */
  const pctOf = (value: number) =>
    team.metrics.capacity === null || team.metrics.capacity <= 0
      ? null
      : Math.round((value / team.metrics.capacity) * 100)
  const setCapacity = useSetCapacity()

  function commitCapacity(raw: string) {
    const trimmed = raw.trim()
    // Empty input CLEARS the capacity. `null` and 0 are different states and the API keeps
    // them apart, so the UI must not collapse a cleared field into a zero.
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      notify.error(t('row.capacityInvalid'))
      return
    }
    const current = team.capacity
    if (next === current) return

    setCapacity.mutate(
      { id: planId, teamId: team.teamId, capacity: next },
      {
        onSuccess: () => notify.success(t('row.capacityUpdated')),
        onError: (err) => notify.error(err.message),
      },
    )
  }

  return (
    <div className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter">
      {gutter}

      <div
        style={colStyleFor('team', { flexShrink: 0 })}
        className="flex min-w-0 items-center gap-1.5 px-2"
      >
        <RowExpandToggle
          expanded={expanded}
          onToggle={onToggleExpanded}
          label={
            expanded
              ? t('row.collapseFeatures', { team: team.teamName ?? '' })
              : t('row.expandFeatures', { team: team.teamName ?? '' })
          }
        />
        <span className="truncate text-foreground" title={team.teamName ?? undefined}>
          {team.teamName ?? '—'}
        </span>
      </div>

      {/* The count lives here so a COLLAPSED team still says how much it carries — hiding the
          children with no trace would make an empty team and a full one look identical. */}
      <div
        style={colStyleFor('features', { flexShrink: 0 })}
        className="px-2 text-right text-muted-foreground tabular-nums"
      >
        {featureCount}
        {/* The warning COUNT, as Rally shows it: on a plan with a dozen teams "⚠5" says which row
            to read first, where a bare triangle only says "something". */}
        <WarningCountBadge count={warnings.length} label={warnings.join('. ')} />
      </div>

      {/* The bar draws the warning glyph but does NOT name it: the `WarningCountBadge` above
          already lists every rule that fired, and two nodes with the same accessible name make a
          screen reader read the reason twice. Rally shows the glyph inside the bar because its
          POSITION says where the bar failed, which the badge cannot express. */}
      <div style={colStyleFor('progress', { flexShrink: 0 })} className="min-w-0 px-2">
        <CompositeBar
          complete={team.metrics.complete}
          rollup={team.metrics.rollup}
          estimated={team.metrics.estimated}
          capacity={team.metrics.capacity}
          targetLoadPct={targetLoadPct}
          warningLabels={warnings}
          warningLabelled={false}
          title={t('row.barTooltip', {
            complete: team.metrics.complete,
            rollup: team.metrics.rollup,
            estimated: team.metrics.estimated,
            unit: unitLabel,
          })}
        />
      </div>

      {/* The three numbers Rally prints BESIDE the bar. An earlier version of this grid collapsed
          them into the bar, so they could only be read by hovering — the bar answers "is this team
          over?", the numbers answer "by how much". No percentage without an entered capacity: there
          is no base, and 100% would claim the team exactly fills a ceiling nobody set. */}
      <div style={colStyleFor('complete', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={team.metrics.complete} pct={pctOf(team.metrics.complete)} />
      </div>
      <div style={colStyleFor('rollup', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={team.metrics.rollup} pct={pctOf(team.metrics.rollup)} />
      </div>
      <div style={colStyleFor('estimated', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={team.metrics.estimated} pct={pctOf(team.metrics.estimated)} />
      </div>

      <div
        style={colStyleFor('capacity', { flexShrink: 0 })}
        className="min-w-0 px-0"
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          fullCell
          value={team.capacity === null ? '' : String(team.capacity)}
          canEdit={canManage}
          onCommit={commitCapacity}
          ariaLabel={t('row.capacityLabel', { team: team.teamName ?? '' })}
          // Blank, not "0" — an unentered capacity is not a ceiling of zero.
          displayValue={
            team.capacity === null ? (
              <span className="text-foreground-subtle">{t('row.notEntered')}</span>
            ) : (
              <span className="tabular-nums">
                {team.capacity} <span className="text-foreground-subtle">{unitLabel}</span>
              </span>
            )
          }
          className="block w-full text-right"
          inputClassName="w-full rounded border border-primary bg-transparent px-1 py-0.5 text-right text-ui-sm text-foreground focus:outline-none"
        />
      </div>

      <div
        style={colStyleFor('actions', { flexShrink: 0 })}
        className="flex items-center justify-center px-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Forecast is a READ — offered even on a published plan, where nothing may be set.
            The modal hides its "Use" buttons in that case rather than the whole tool. */}
        <IconButton
          aria-label={t('forecast.forTeam', { team: team.teamName ?? '' })}
          onClick={onForecast}
        >
          <Sparkles size={13} />
        </IconButton>
        {/* No delete here: Rally changes a plan's teams through `Add / Remove Project(s) to Plan`,
            the checkbox dialog on the toolbar. A per-row trash can also invited removing a team
            whose demand has to be moved first, which the API refuses — the dialog says so before
            the click instead of after it. */}
      </div>
    </div>
  )
}
