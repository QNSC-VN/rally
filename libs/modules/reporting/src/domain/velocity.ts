import { roundForDisplay } from './report-scope';

/**
 * Velocity classification and averages (Velocity SRS §3 and §5).
 *
 * Velocity is deliberately NOT snapshotted: it is recalculated from the CURRENT iteration
 * assignment, the current accepted-equivalent state and the persisted `acceptedDate`
 * every time it is asked for. Moving an item out of a closed iteration removes it from
 * that bar; moving one in adds it. That is the opposite of Burndown and is why the two
 * reports cannot share a data path.
 */

/** One currently-assigned Story or Defect, as the classifier needs it. */
export interface VelocityItem {
  /** Stable work item id — the de-duplication key for All Teams. */
  id: string;
  /** `story_points`, the BA's Plan Estimate. Null counts as zero points, not excluded. */
  planEstimate: number | null;
  /** True when schedule_state ∈ {accepted, release}. */
  acceptedEquivalent: boolean;
  /** The persisted acceptance timestamp. Null while not accepted. */
  acceptedDate: Date | null;
}

export type VelocitySegment = 'during' | 'after' | 'not-accepted' | 'unclassified';

/**
 * Which of the three mutually exclusive segments an item's points belong to.
 *
 * `unclassified` is the fourth outcome the SRS forces us to model: an item that IS
 * accepted-equivalent but has no `acceptedDate`. "An Accepted/Release item without
 * `acceptedDate` is a data-quality error. DEV must backfill it from auditable history;
 * the report must not guess whether it was accepted during or after the Iteration."
 * Guessing either way would misstate velocity, so it is surfaced instead.
 */
export function classify(item: VelocityItem, iterationEndBoundary: Date): VelocitySegment {
  if (!item.acceptedEquivalent) return 'not-accepted';
  if (item.acceptedDate === null) return 'unclassified';
  return item.acceptedDate.getTime() <= iterationEndBoundary.getTime() ? 'during' : 'after';
}

export interface VelocityBar {
  /** The shared timebox this bar aggregates (one iteration, or N fused Team iterations). */
  timeboxKey: string;
  /** Display label — the timebox name, never a join key. */
  name: string;
  startDate: string | null;
  endDate: string | null;
  acceptedDuring: number;
  acceptedAfter: number;
  notAccepted: number;
  /**
   * Points that could not be classified because an accepted item has no acceptedDate.
   * Excluded from the three segments so the stack cannot silently absorb them, and
   * reported so the gap is visible.
   */
  unclassified: number;
  /** Count of items behind `unclassified`, for the UI's data-quality warning. */
  unclassifiedItems: number;
  /** How many Team iterations were fused. 1 for a selected Team. */
  iterationCount: number;
}

/**
 * Split one timebox's currently-assigned items into the three stacked segments.
 *
 * De-duplicates by work item id first: for All Teams the same item can be reached through
 * more than one Team's iteration join, and counting it twice would inflate the bar
 * (§2 "de-duplicate Work Items by ID").
 *
 * Invariant (§3): during + after + notAccepted + unclassified equals the sum of every
 * distinct assigned item's plan estimate. `unclassified` is part of the identity on
 * purpose — dropping it would break the invariant the SRS states.
 */
export function buildBar(input: {
  timeboxKey: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  endBoundary: Date;
  iterationCount: number;
  items: readonly VelocityItem[];
}): VelocityBar {
  const seen = new Set<string>();
  let during = 0;
  let after = 0;
  let notAccepted = 0;
  let unclassified = 0;
  let unclassifiedItems = 0;

  for (const item of input.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const points = item.planEstimate ?? 0;
    switch (classify(item, input.endBoundary)) {
      case 'during':
        during += points;
        break;
      case 'after':
        after += points;
        break;
      case 'not-accepted':
        notAccepted += points;
        break;
      case 'unclassified':
        unclassified += points;
        unclassifiedItems += 1;
        break;
    }
  }

  return {
    timeboxKey: input.timeboxKey,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    acceptedDuring: roundForDisplay(during),
    acceptedAfter: roundForDisplay(after),
    notAccepted: roundForDisplay(notAccepted),
    unclassified: roundForDisplay(unclassified),
    unclassifiedItems,
    iterationCount: input.iterationCount,
  };
}

export interface VelocityAverages {
  /** AVG of every During value in the window — the flat Trend line. */
  trend: number | null;
  last3: number | null;
  best3: number | null;
  worst3: number | null;
  /**
   * How many values each average actually used. "If fewer than three eligible Iterations
   * exist, Last/Best/Worst use all available values and the UI must expose the actual
   * sample size."
   */
  sampleSize: number;
}

/**
 * Trend and the three averages, from `acceptedDuring` ONLY.
 *
 * "`acceptedAfter` and `notAccepted` are visual context and are excluded from every
 * trend/average calculation." Work accepted late did not happen in that iteration, so
 * counting it would make a chronically late team look fast.
 */
export function computeAverages(barsOldestFirst: readonly VelocityBar[]): VelocityAverages {
  const during = barsOldestFirst.map((b) => b.acceptedDuring);
  if (during.length === 0) {
    return { trend: null, last3: null, best3: null, worst3: null, sampleSize: 0 };
  }
  const avg = (xs: readonly number[]): number =>
    roundForDisplay(xs.reduce((a, b) => a + b, 0) / xs.length);
  const take = Math.min(3, during.length);
  const descending = [...during].sort((a, b) => b - a);
  const ascending = [...during].sort((a, b) => a - b);

  return {
    trend: avg(during),
    // "3 most recent" — the window is ordered oldest first, so the tail.
    last3: avg(during.slice(-take)),
    best3: avg(descending.slice(0, take)),
    worst3: avg(ascending.slice(0, take)),
    sampleSize: during.length,
  };
}

/** The two windows the report offers. Default is Last 5 (§6). */
export const VELOCITY_WINDOWS = [5, 10] as const;
export type VelocityWindow = (typeof VELOCITY_WINDOWS)[number];
export const DEFAULT_VELOCITY_WINDOW: VelocityWindow = 5;

/**
 * The most recent N eligible timeboxes, oldest first.
 *
 * "Sort eligible Iterations by end date ascending, then display the most recent 5 or 10."
 * Eligibility itself (ended before today, at least one Story/Defect assigned) is a query
 * concern — a timebox with no scheduled work never reaches this function.
 */
export function selectWindow<T extends { endDate: string | null }>(
  eligibleOldestFirst: readonly T[],
  window: VelocityWindow,
): T[] {
  return eligibleOldestFirst.slice(-window);
}
