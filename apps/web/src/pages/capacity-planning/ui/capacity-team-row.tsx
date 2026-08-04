import { type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'

import { useSetCapacity, type CapacityPlanTeam } from '@/features/capacity-planning/api'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { MetricValue } from '@/shared/ui/metric-value'
import { WarningCountBadge } from '@/shared/ui/warning-count-badge'
import { CompositeBar } from '@/shared/ui/composite-bar'
import { CapacityBarTooltip } from './capacity-bar-tooltip'
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
  canManage,
  colStyleFor,
  gutter,
  onForecast,
  expanded,
  onToggleExpanded,
  featureCount,
  featuresRequiringAttention,
}: {
  planId: string
  team: CapacityPlanTeam
  /** "points" / "items" — the plan's fixed unit, shown beside the number. */
  unitLabel: string
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
  /**
   * How many of this team's allocated FEATURES breach their own Feature-level rule.
   *
   * The BA is specific about this badge: it sits beside the Features count and "if one or more
   * allocated Features under the Team exceed their Feature-level rule (`Rollup > Estimated`), show
   * a red attention badge beside the count. Hover/focus on the badge shows
   * `{N} Feature(s) require attention`" (Capacity SRS:121). It used to render
   * `team.metrics.warnings.length` — the TEAM's own warnings, which include capacity rules that say
   * nothing about any Feature — so the number beside the Features column was counting something
   * else entirely, under copy that promised Features.
   */
  featuresRequiringAttention: number
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()
  const warnings = warningText(team.metrics.warnings)
  /**
   * Share of THIS team's capacity, or null when it has entered none.
   *
   * Floored, as Rally floors: "the percentages shown are rounded down to the nearest whole number".
   * The same rule lives in `pctOfCapacity` for the plan-wide figures — this row divides by the TEAM's
   * ceiling rather than the plan's, which is why it does the arithmetic itself.
   */
  const pctOf = (value: number) =>
    team.metrics.capacity === null || team.metrics.capacity <= 0
      ? null
      : Math.floor((value / team.metrics.capacity) * 100)
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
        <span
          className="break-words whitespace-normal text-foreground"
          title={team.teamName ?? undefined}
        >
          {team.teamName ?? '--'}
        </span>
      </div>

      {/* The count lives here so a COLLAPSED team still says how much it carries — hiding the
          children with no trace would make an empty team and a full one look identical. */}
      {/* `inline-flex` + `items-center`, not a text block: the badge is a pill with its own line
          height, so inside plain text it rode ABOVE the count's baseline. */}
      <div
        style={colStyleFor('features', { flexShrink: 0 })}
        className="flex items-center justify-end gap-1 px-2 text-muted-foreground tabular-nums"
      >
        {featureCount}
        {/* The warning COUNT, as Rally shows it: on a plan with a dozen teams "⚠5" says which row
            to read first, where a bare triangle only says "something". */}
        <WarningCountBadge
          count={featuresRequiringAttention}
          heading={t('warnings.featuresRequireAttention', { count: featuresRequiringAttention })}
          // The team's own warnings stay as the detail text: they are why the row is worth
          // opening, and dropping them would trade one true number for less information.
          label={warnings.join('. ')}
        />
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
          warningLabels={warnings}
          /**
           * The BAR names the team's warnings now.
           *
           * It was `false` because the Features cell's badge carried the same accessible name and
           * two nodes reading it would say the reason twice. That badge now counts FEATURES
           * requiring attention (SRS:121), which is a different quantity and says nothing about
           * `No capacity entered` — so without this the team's own warnings had no accessible name
           * anywhere on the row. SRS:128 puts them here anyway: "a red warning triangle on the
           * progress bar and in the hover breakdown".
           */
          warningLabelled

          tooltip={
            <CapacityBarTooltip
              complete={team.metrics.complete}
              rollup={team.metrics.rollup}
              estimated={team.metrics.estimated}
              capacity={team.metrics.capacity}
            />
          }
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
          inputClassName="w-full rounded border border-primary bg-transparent px-1 py-0.5 text-right text-inherit text-foreground focus:outline-none"
        />
      </div>

      <div
        style={colStyleFor('actions', { flexShrink: 0 })}
        className="flex items-center justify-center px-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* DRAFT ONLY. The forecast proposes a Capacity, and the BA is explicit that "Capacity stays
            disabled after Publish" — offering the tool on a published plan put the one remaining
            mutation aid on a surface where every other control is correctly read-only. It reads as an
            invitation the plan cannot accept. `canManage` is already false once published. */}
        {canManage && (
          <IconButton
            aria-label={t('forecast.forTeam', { team: team.teamName ?? '' })}
            onClick={onForecast}
          >
            <Sparkles size={13} />
          </IconButton>
        )}
        {/* No delete here: Rally changes a plan's teams through `Add / Remove Project(s) to Plan`,
            the checkbox dialog on the toolbar. A per-row trash can also invited removing a team
            whose demand has to be moved first, which the API refuses — the dialog says so before
            the click instead of after it. */}
      </div>
    </div>
  )
}
