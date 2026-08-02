import { roundForDisplay } from './report-scope';
import type { TeamScope } from './report-scope';

/**
 * Release Tracking classification and totals (RT-BR-01…08).
 *
 * Everything here is a rule the BA wrote down, expressed over plain rows. The repository
 * produces the rows for one Release and one Project/Team scope; this module decides which
 * bucket each row belongs to and what its Status cell says.
 *
 * The classification is deliberately structural: it reads `releaseId` on the Feature and
 * on its children, and NEVER infers membership from a completion percentage or from what
 * fraction of children match the Release (RT §3, and acceptance example 5).
 */

/** One unit selector drives BOTH the grid's Status column and the Burnup chart (RT-BR-05). */
export type ChartUnit = 'points' | 'count';

export type ReleaseBucket = 'direct' | 'derived' | 'unparented';

/** A Story or Defect. `featureId` null means unparented. */
export interface ReleaseChild {
  id: string;
  itemKey: string;
  type: 'story' | 'defect';
  title: string;
  featureId: string | null;
  releaseId: string | null;
  releaseName: string | null;
  teamId: string | null;
  teamName: string | null;
  planEstimate: number | null;
  /** schedule_state ∈ {accepted, release}. `Completed` is NOT accepted (RT-AC-08). */
  acceptedEquivalent: boolean;
  scheduleState: string;
}

/** A portfolio Feature. */
export interface ReleaseFeature {
  id: string;
  itemKey: string;
  name: string;
  releaseId: string | null;
  teamId: string | null;
  teamName: string | null;
  rank: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /** Top-down forecast. 0 means "not forecast" since migration 0079. */
  refinedPoints: number;
  refinedCount: number;
  /** What this Feature's Preliminary Estimate size maps to in workspace settings. */
  preliminaryPoints: number;
  preliminaryCount: number;
}

/** Does this row's Team ownership fall inside the selected scope? */
export function inScope(teamId: string | null, scope: TeamScope): boolean {
  // All Teams = every Team in the selected Project, including work with no Team yet:
  // excluding it would make the three bucket totals disagree with the project's own
  // backlog, and the page's only scope control is the global one.
  if (scope.kind === 'all') return true;
  return teamId === scope.teamId;
}

// ── Buckets ─────────────────────────────────────────────────────────────────

export interface FeatureBuckets<F extends ReleaseFeature = ReleaseFeature> {
  direct: F[];
  derived: F[];
  /** For a Derived Feature: the scoped children that caused its inclusion. */
  derivedCause: Map<string, ReleaseChild[]>;
}

/**
 * Split Features into `Features in Release` and `Derived Features`.
 *
 * Direct (RT-BR-01): `Feature.releaseId = R` and the Feature's Team is in scope.
 * Derived (RT-BR-02): `Feature.releaseId != R` (including unassigned) AND at least one
 * direct Story/Defect child has `releaseId = R` with its Team in scope.
 *
 * The two conditions on `Feature.releaseId` are opposites, so the buckets cannot overlap —
 * that is what makes them "mutually exclusive" without a second de-duplication pass. One
 * Feature can still be Direct for Release A and Derived for Release B, which is the SRS's
 * own worked example.
 */
export function bucketFeatures<F extends ReleaseFeature>(
  features: readonly F[],
  children: readonly ReleaseChild[],
  releaseId: string,
  scope: TeamScope,
): FeatureBuckets<F> {
  const scopedChildrenByFeature = new Map<string, ReleaseChild[]>();
  for (const child of children) {
    if (child.featureId === null) continue;
    if (child.releaseId !== releaseId) continue;
    if (!inScope(child.teamId, scope)) continue;
    const list = scopedChildrenByFeature.get(child.featureId);
    if (list) list.push(child);
    else scopedChildrenByFeature.set(child.featureId, [child]);
  }

  const direct: F[] = [];
  const derived: F[] = [];
  const derivedCause = new Map<string, ReleaseChild[]>();

  for (const feature of features) {
    if (feature.releaseId === releaseId) {
      if (inScope(feature.teamId, scope)) direct.push(feature);
      continue;
    }
    const cause = scopedChildrenByFeature.get(feature.id);
    if (cause && cause.length > 0) {
      derived.push(feature);
      derivedCause.set(feature.id, cause);
    }
  }

  return { direct, derived, derivedCause };
}

/**
 * `Unparented User Stories and Defects` (RT-BR-04): release matches, Team in scope, and no
 * Feature parent.
 *
 * Scoped to its OWN release on purpose — RT-Q-01's superseded wording had these appearing
 * under every Release filter.
 */
export function unparentedItems(
  children: readonly ReleaseChild[],
  releaseId: string,
  scope: TeamScope,
): ReleaseChild[] {
  return dedupe(
    children.filter(
      (c) => c.featureId === null && c.releaseId === releaseId && inScope(c.teamId, scope),
    ),
  );
}

// ── Status cells ────────────────────────────────────────────────────────────

export interface StatusValue {
  accepted: number;
  total: number;
  /** Floored percent, or null when the denominator is zero. Derived rows have no percent. */
  percent: number | null;
}

const measure = (items: readonly ReleaseChild[], unit: ChartUnit): number =>
  unit === 'points'
    ? roundForDisplay(items.reduce((sum, i) => sum + (i.planEstimate ?? 0), 0))
    : items.length;

/**
 * A DIRECT Feature's Status uses EVERY direct child — including children assigned to
 * another Release or to none (RT-BR-05). The cell shows the floored percentage plus
 * `accepted/total`.
 *
 * `Math.floor`, not rounding: 99.6% must not display as 100% while work is outstanding.
 */
export function directStatus(children: readonly ReleaseChild[], unit: ChartUnit): StatusValue {
  const all = dedupe(children);
  const total = measure(all, unit);
  const accepted = measure(
    all.filter((c) => c.acceptedEquivalent),
    unit,
  );
  return { accepted, total, percent: total > 0 ? Math.floor((accepted / total) * 100) : null };
}

/**
 * A DERIVED Feature's Status uses ONLY the children whose Release matches and whose Team
 * is in scope, and shows `accepted/total` with NO percentage (RT-BR-05).
 *
 * No percentage because the denominator is a slice of the Feature, not the Feature: a
 * percentage would invite reading it as the Feature's progress, which is what the Direct
 * cell means.
 */
export function derivedStatus(
  scopedChildren: readonly ReleaseChild[],
  unit: ChartUnit,
): StatusValue {
  const all = dedupe(scopedChildren);
  return {
    accepted: measure(
      all.filter((c) => c.acceptedEquivalent),
      unit,
    ),
    total: measure(all, unit),
    percent: null,
  };
}

// ── Release totals and the tracked population ───────────────────────────────

/**
 * `TrackedLeaves(R, S)` — the ONE population behind Planned, Accepted and the Burnup
 * (RT §4.1): distinct Story/Defect with `releaseId = R` whose Team is in scope.
 *
 * Features are never counted as Release work items, and neither are Tasks: Plan Estimate
 * and release classification are owned by Story/Defect in this model.
 */
export function trackedLeaves(
  children: readonly ReleaseChild[],
  releaseId: string,
  scope: TeamScope,
): ReleaseChild[] {
  return dedupe(children.filter((c) => c.releaseId === releaseId && inScope(c.teamId, scope)));
}

export interface ReleaseTotals {
  planned: number;
  accepted: number;
  preliminary: number;
}

/**
 * Planned (RT-BR-06), Accepted (RT-BR-07) and Preliminary (RT-BR-08) in the selected unit.
 *
 * Accepted admits {Accepted, Release} only. `Completed` contributes to Planned but not to
 * Accepted — the distinction the whole report turns on.
 */
export function releaseTotals(
  leaves: readonly ReleaseChild[],
  featuresInRelease: readonly ReleaseFeature[],
  unit: ChartUnit,
): ReleaseTotals {
  return {
    planned: measure(leaves, unit),
    accepted: measure(
      leaves.filter((c) => c.acceptedEquivalent),
      unit,
    ),
    preliminary: preliminaryTotal(featuresInRelease, unit),
  };
}

/**
 * The Preliminary Estimate line: the sum of the TOP-DOWN Feature estimate over the Direct
 * and Derived Features, de-duplicated by Feature id.
 *
 * Tier order matches the portfolio module's existing `resolveEstimate`: the refined
 * forecast when it is greater than zero, otherwise the workspace's Preliminary Estimate
 * size mapping. Since migration 0079 the refined columns are NOT NULL DEFAULT 0, so 0 is
 * the single representation of "not forecast" and falls through to the mapping.
 *
 * This is a planning reference line, never the denominator of Feature progress.
 */
export function preliminaryTotal(features: readonly ReleaseFeature[], unit: ChartUnit): number {
  const seen = new Set<string>();
  let total = 0;
  for (const feature of features) {
    if (seen.has(feature.id)) continue;
    seen.add(feature.id);
    total +=
      unit === 'points'
        ? feature.refinedPoints > 0
          ? feature.refinedPoints
          : feature.preliminaryPoints
        : feature.refinedCount > 0
          ? feature.refinedCount
          : feature.preliminaryCount;
  }
  return roundForDisplay(total);
}

// ── Issues ──────────────────────────────────────────────────────────────────

export interface ReleaseMismatch {
  childId: string;
  childKey: string;
  childTitle: string;
  childType: 'story' | 'defect';
  /** The Release the child actually points at. Never null — an unassigned child is not a mismatch. */
  itemReleaseId: string;
  itemReleaseName: string | null;
}

/**
 * Release-mismatch issues for a Direct Feature (RT §5).
 *
 * "A Direct Feature displays an Issue warning when at least one direct child has a
 * non-null `releaseId` different from the selected Release. An unassigned child does not
 * trigger the warning." An unassigned child is not ready for Release Tracking (RT-BR-03),
 * which is a planning gap rather than a contradiction.
 */
export function releaseMismatches(
  children: readonly ReleaseChild[],
  releaseId: string,
): ReleaseMismatch[] {
  return dedupe(children)
    .filter((c) => c.releaseId !== null && c.releaseId !== releaseId)
    .map((c) => ({
      childId: c.id,
      childKey: c.itemKey,
      childTitle: c.title,
      childType: c.type,
      itemReleaseId: c.releaseId as string,
      itemReleaseName: c.releaseName,
    }));
}

/**
 * Does EVERY release-assigned child point somewhere else?
 *
 * Warned separately because it means something different: the Feature's own `releaseId`
 * is probably stale or plain wrong, rather than a few children having drifted. Independent
 * of `% Done` — a Feature can be 100% accepted and still fully mismatched (example 8).
 */
export function isFullMismatch(children: readonly ReleaseChild[], releaseId: string): boolean {
  const assigned = dedupe(children).filter((c) => c.releaseId !== null);
  return assigned.length > 0 && assigned.every((c) => c.releaseId !== releaseId);
}

/**
 * The Issues panel's progress lines: total points, Story only, Defect only.
 *
 * Calculated from ALL direct children and independent of mismatch classification (§5).
 * The approved mockup shows two lines (total points and defects); the SRS asks for Story
 * progress as well, so all three are returned and the mockup's omission is treated as the
 * fixture gap it is.
 */
export function featureProgress(children: readonly ReleaseChild[]): {
  points: StatusValue;
  stories: StatusValue;
  defects: StatusValue;
} {
  const all = dedupe(children);
  return {
    points: directStatus(all, 'points'),
    stories: directStatus(
      all.filter((c) => c.type === 'story'),
      'count',
    ),
    defects: directStatus(
      all.filter((c) => c.type === 'defect'),
      'count',
    ),
  };
}

// ── Burnup ──────────────────────────────────────────────────────────────────

/** Why a burnup cannot be trusted yet (RT-BR-09, §5.1). */
export type BurnupHistoryState = 'complete' | 'partial' | 'missing' | 'no-baseline';

export interface BurnupPoint {
  date: string;
  accepted: number | null;
  planned: number | null;
  preliminary: number | null;
  /** The straight trajectory from 0 at Release start to the approved target at end. */
  ideal: number | null;
}

export interface StoredBurnupRow {
  date: string;
  accepted: number;
  planned: number;
  preliminary: number;
}

/**
 * Assemble the four series from stored snapshots plus the persisted Ideal target.
 *
 * The mockup generates its curves from today's totals; RT-BR-09 forbids that
 * ("The current data model contains only present-state records and cannot reconstruct a
 * trustworthy historical burnup"), so measured days come from snapshots and days with no
 * snapshot are emitted as `null` — a visible gap, not a zero.
 *
 * `Ideal` is drawn from the PERSISTED baseline only. With no baseline there is no ideal
 * trajectory, and inventing one from today's mutable Planned value would silently redraw
 * history every time scope changed.
 */
export function buildBurnup(input: {
  /** Every calendar date in the release window, ascending. */
  axis: readonly string[];
  idealTarget: number | null;
  snapshots: readonly StoredBurnupRow[];
}): { points: BurnupPoint[]; historyState: BurnupHistoryState } {
  const byDate = new Map(input.snapshots.map((s) => [s.date, s]));
  const last = input.axis.length - 1;

  const points: BurnupPoint[] = input.axis.map((date, i) => {
    const snap = byDate.get(date);
    return {
      date,
      accepted: snap ? roundForDisplay(snap.accepted) : null,
      planned: snap ? roundForDisplay(snap.planned) : null,
      preliminary: snap ? roundForDisplay(snap.preliminary) : null,
      ideal:
        input.idealTarget === null
          ? null
          : last <= 0
            ? roundForDisplay(input.idealTarget)
            : roundForDisplay((input.idealTarget * i) / last),
    };
  });

  const measured = points.filter((p) => p.accepted !== null).length;
  const historyState: BurnupHistoryState =
    input.idealTarget === null && measured === 0
      ? 'no-baseline'
      : measured === 0
        ? 'missing'
        : measured === input.axis.length
          ? 'complete'
          : 'partial';

  return { points, historyState };
}

// ── shared ──────────────────────────────────────────────────────────────────

/**
 * De-duplicate by stable id.
 *
 * Applied at every aggregation boundary because an All Teams query reaches the same work
 * item through more than one join path, and "Aggregation must de-duplicate by stable Work
 * Item or Task ID" is a data-quality rule, not an optimisation.
 */
function dedupe(items: readonly ReleaseChild[]): ReleaseChild[] {
  const seen = new Set<string>();
  const out: ReleaseChild[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
