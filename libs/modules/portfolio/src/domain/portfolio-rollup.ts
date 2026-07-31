/**
 * Portfolio progress and estimate arithmetic — every formula from the BA spec,
 * as pure functions over plain numbers.
 *
 * Pure on purpose: these are the rules the whole feature is judged on, and they
 * must be verifiable without a database. The repository's job is to produce the
 * aggregate inputs (one SQL query per surface); this module's job is to turn them
 * into the numbers the UI shows. Nothing here reads a clock, a request or a row.
 *
 * TWO DIFFERENT DEFINITIONS OF "DONE", BOTH DELIBERATE
 *
 * The spec uses two, and `db/schema/enums.ts` already models both:
 *
 *   Portfolio Percent Done  → ACCEPTED_SCHEDULE_STATES  (accepted, release)
 *   Capacity plan Complete  → COMPLETED_SCHEDULE_STATES (completed, accepted, release)
 *
 * That is not an inconsistency in the spec — it is the D1 distinction documented on
 * those constants. A portfolio item reports what the business has *signed off*; a
 * capacity plan reports what the team has *finished*. Do not unify them; the SQL
 * that feeds `accepted*` and `complete*` must use the matching constant.
 */

/** Raw aggregate for one portfolio item, produced by one SQL query. */
export interface PortfolioRollupInput {
  /** SUM(story_points) over linked Story/Defect. */
  rollupPoints: number;
  /** COUNT(*) over linked Story/Defect. */
  rollupCount: number;
  /** SUM(story_points) FILTER (accepted states). */
  acceptedPoints: number;
  /** COUNT(*) FILTER (accepted states). */
  acceptedCount: number;
}

/** Optional top-down forecasts stored on the item, plus the workspace fallback. */
export interface PortfolioForecastInput {
  /**
   * `refined_estimate`. Since 0077 the column is NOT NULL DEFAULT 0, so a real row carries
   * 0 rather than null when nothing was forecast; nullable is kept only for callers that
   * assemble this input from a partial read-model.
   */
  refinedPoints: number | null;
  /** `refined_item_count_estimate`. Same 0-means-not-forecast rule. */
  refinedCount: number | null;
  /** Points the item's Preliminary Estimate size maps to, from workspace settings. */
  preliminaryPoints: number;
  /** Item count the item's Preliminary Estimate size maps to, from workspace settings. */
  preliminaryCount: number;
}

/**
 * The four read-only indicators on a Feature or Epic.
 *
 * Each is a fraction 0–1, or `null` when its denominator is zero. `null` is not 0:
 * "no work linked" and "none of the work is done" look identical as 0% and must not,
 * because the first is a data-entry gap and the second is a delivery problem. The UI
 * renders null as an empty meter, matching the spec's "a Feature with no linked
 * Story/Defect shows 0% progress" while still being able to warn about the gap.
 */
export interface PortfolioProgress {
  percentDoneByPlanEstimate: number | null;
  percentDoneByCount: number | null;
  estimatedProgressByPoints: number | null;
  estimatedProgressByCount: number | null;
}

export function computePortfolioProgress(
  rollup: PortfolioRollupInput,
  forecast: PortfolioForecastInput,
): PortfolioProgress {
  // Denominator is the LIVE rollup: accepted over everything currently linked. Add a
  // story and the percentage drops, which is the intended behaviour — scope growth is
  // visible rather than hidden.
  const percentDoneByPlanEstimate = ratio(rollup.acceptedPoints, rollup.rollupPoints);
  const percentDoneByCount = ratio(rollup.acceptedCount, rollup.rollupCount);

  // Denominator is the top-down FORECAST, so this indicator answers a different
  // question: how much of what we predicted has landed. Falls back to the Preliminary
  // Estimate mapping when no refined forecast was supplied.
  const pointsTarget = forecastTarget(forecast.refinedPoints, forecast.preliminaryPoints);
  const countTarget = forecastTarget(forecast.refinedCount, forecast.preliminaryCount);

  return {
    percentDoneByPlanEstimate,
    percentDoneByCount,
    estimatedProgressByPoints: ratio(rollup.acceptedPoints, pointsTarget),
    estimatedProgressByCount: ratio(rollup.acceptedCount, countTarget),
  };
}

// ── Capacity planning estimate tiers ────────────────────────────────────────

/** Which tier produced an estimate — surfaced in the UI so a planner can tell a
 *  commitment from a forecast. */
export type EstimateTier = 'allocated' | 'refined' | 'preliminary' | 'none';

export interface ResolvedEstimate {
  value: number;
  tier: EstimateTier;
}

export interface EstimateTierInput {
  /**
   * SUM(allocation.value) for this Feature in this plan, counting ONLY rows assigned
   * to a Team. An Unallocated placeholder must not outrank a forecast, or Feature
   * Estimated stops reconciling with the Team Demand totals.
   */
  totalAllocated: number;
  /** Refined forecast in the plan's unit, or null. */
  refined: number | null;
  /** Preliminary Estimate mapping in the plan's unit. */
  preliminary: number;
}

/**
 * Feature Estimated for the planning surfaces — Features tab and the cutline.
 *
 * Order is Allocated → Refined → Preliminary → none. Once a planner has committed
 * demand, that total is the truth and outranks any top-down forecast; the forecasts
 * only stand in until an allocation exists.
 */
export function resolveEstimate(input: EstimateTierInput): ResolvedEstimate {
  if (input.totalAllocated > 0) return { value: input.totalAllocated, tier: 'allocated' };
  if (input.refined !== null && input.refined > 0) return { value: input.refined, tier: 'refined' };
  if (input.preliminary > 0) return { value: input.preliminary, tier: 'preliminary' };
  return { value: 0, tier: 'none' };
}

/**
 * The value pre-filled in the Allocate dialog when the planner leaves Estimate blank.
 *
 * DELIBERATELY SKIPS THE ALLOCATED TIER, and this is the subtlest rule in the
 * feature: folding allocations back in would mean a blank field commits the sum of
 * the very allocations it is being used to create. Refined → Preliminary only.
 */
export function defaultAllocationEstimate(
  input: Pick<EstimateTierInput, 'refined' | 'preliminary'>,
): ResolvedEstimate {
  if (input.refined !== null && input.refined > 0) return { value: input.refined, tier: 'refined' };
  if (input.preliminary > 0) return { value: input.preliminary, tier: 'preliminary' };
  return { value: 0, tier: 'none' };
}

// ── Capacity warnings ───────────────────────────────────────────────────────

/**
 * Advisory warnings. Never block a planning action — they inform, they do not gate.
 *
 * The first three mirror the errors Rally's Capacity Planning page raises by name:
 * "Feature Missing Estimate Error", "Feature Rollup Exceeds Estimate Error" and "Team
 * Estimate Exceeds Team Capacity", plus the missing-team-capacity case that Rally
 * describes as cascading into the others. `rollup_exceeds_capacity` and
 * `load_above_target` are ours: the first because a team's live children can outgrow the
 * ceiling even when the commitment did not, the second because Rally's own guidance is to
 * leave roughly 20% for unplanned work and `capacity_plans.target_load_pct` records it.
 */
export type CapacityWarning =
  | 'feature_missing_estimate'
  | 'team_missing_capacity'
  | 'rollup_exceeds_estimated'
  | 'rollup_exceeds_capacity'
  | 'estimated_exceeds_capacity'
  | 'load_above_target';

export interface CapacityWarningInput {
  /**
   * Which kind of row this is, stated rather than inferred.
   *
   * `capacity: null` used to carry two different meanings — "a Feature has no ceiling of
   * its own" and "nobody has entered this team's capacity yet" — and the second is the one
   * Rally raises an error for. Inferring the row kind from the ceiling made that error
   * unexpressible, so the kind is now explicit.
   */
  kind: 'team' | 'feature';
  /** Live SUM(story_points) of children generated from allocated Features. */
  rollup: number;
  /** Committed demand — SUM(allocation.value). */
  estimated: number;
  /** Manually entered capacity, or null when the planner has not entered one. */
  capacity: number | null;
  /** Which tier produced the Feature's estimate. Only read for `kind: 'feature'`. */
  tier?: EstimateTier;
  /**
   * Advisory ceiling as a percentage of capacity, below 100. Rally's guidance is to
   * leave roughly 20% for unplanned work, so a team at 95% warrants a warning even
   * though it is not over capacity. Omit to disable that check.
   */
  targetLoadPct?: number | null;
}

/** Evaluate the warning rules for one row. */
export function computeCapacityWarnings(input: CapacityWarningInput): CapacityWarning[] {
  const warnings: CapacityWarning[] = [];

  // Rally's "Feature Missing Estimate Error": no tier produced a number, so this Feature
  // cannot be planned against a capacity at all. Reported ahead of the comparison rules
  // because it is the CAUSE — a zero estimate is why the rollup exceeds it.
  if (input.kind === 'feature' && input.tier === 'none') {
    warnings.push('feature_missing_estimate');
  }

  // Rally: missing team capacity is itself an error, and every capacity comparison below
  // is unevaluable until it is entered. Reported instead of them, not alongside — a row
  // that silently skipped its checks reads as "all clear", which is the opposite of true.
  if (input.kind === 'team' && (input.capacity === null || input.capacity <= 0)) {
    warnings.push('team_missing_capacity');
  }

  // Children have outgrown the commitment: the plan under-committed for this work.
  if (input.rollup > input.estimated) warnings.push('rollup_exceeds_estimated');

  if (input.capacity !== null && input.capacity > 0) {
    if (input.rollup > input.capacity) warnings.push('rollup_exceeds_capacity');
    if (input.estimated > input.capacity) warnings.push('estimated_exceeds_capacity');

    // Only meaningful below the hard limit — above capacity the two rules above
    // already fired, and a second warning saying the same thing is noise.
    const target = input.targetLoadPct;
    if (target != null && target > 0 && target < 100) {
      const ceiling = input.capacity * (target / 100);
      if (input.estimated > ceiling && input.estimated <= input.capacity) {
        warnings.push('load_above_target');
      }
    }
  }

  return warnings;
}

/**
 * Fraction of the planned window consumed, for the cutline.
 *
 * Features are walked in rank order accumulating their resolved estimate; the cutline
 * sits after the last item whose running total still fits within capacity. Rally
 * shows the line only in rank-ascending order, because in any other order a running
 * total means nothing.
 *
 * Returns the 0-based index of the last item that fits, or -1 when the first item
 * already exceeds capacity. `null` capacity means no line can be drawn.
 */
export function computeCutlineIndex(
  estimatesInRankOrder: readonly number[],
  capacity: number | null,
): number | null {
  if (capacity === null || capacity <= 0) return null;

  let running = 0;
  let lastFitting = -1;
  for (let i = 0; i < estimatesInRankOrder.length; i += 1) {
    running += estimatesInRankOrder[i] ?? 0;
    if (running > capacity) break;
    lastFitting = i;
  }
  return lastFitting;
}

/**
 * Pick the forecast denominator: the refined number when it is a real forecast, else the
 * Preliminary Estimate mapping.
 *
 * `refined > 0`, NOT `!== null`. The BA spec states the tier that way in three places —
 * "Refined Estimate = Feature.refinedEstimate | refinedWorkItemCountEstimate -> if > 0"
 * (Capacity Planning SRS, echoed in `PHASE5_DEV_HANDOFF` and the UI catalog) — and the
 * mockup renders a stored 0 as an em-dash. Since migration 0077 the column is NOT NULL
 * DEFAULT 0, so 0 IS the "not forecast" value and this comparison is what makes it fall
 * through to the preliminary tier.
 *
 * The null branch is kept because the parameter is still typed nullable for callers that
 * build this input themselves (the capacity plan read-model can carry an absent feature).
 * It used to be `??`, which treated 0 as a real forecast and would have divided by it —
 * disagreeing with `resolveEstimate` above, where 0 falls through. One stored 0 would have
 * meant "blank progress meter" to the Portfolio page and "use the T-shirt size" to Capacity
 * Planning. Both now agree.
 */
function forecastTarget(refined: number | null, preliminary: number): number {
  return refined !== null && refined > 0 ? refined : preliminary;
}

/** `a / b` as a 0–1 fraction, or null when the denominator is not positive. */
function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  const r = numerator / denominator;
  if (Number.isNaN(r)) return null;
  return r < 0 ? 0 : r;
}
