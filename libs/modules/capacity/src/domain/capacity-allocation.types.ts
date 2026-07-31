import type { PreliminaryEstimateSize } from '../../../../../db/schema/enums';
import type { EstimateTier } from '@modules/portfolio';
import type { CapacityWarning } from '@modules/portfolio';

/**
 * One committed allocation: this much of this Feature, to this Team, in this plan.
 *
 * `value` is THE ONLY stored number in Phase 5 (see `db/schema/work.ts`). Everything else
 * on these surfaces is aggregated on read, deliberately: a plan records what was
 * COMMITTED, so it must not drift when the Feature's child estimates change afterwards.
 *
 * `teamId === null` is the Unallocated bucket — demand a planner has parked on the plan
 * without choosing a team yet. It is modelled as a null team rather than a second table.
 */
export interface CapacityAllocation {
  id: string;
  planId: string;
  portfolioItemId: string;
  teamId: string | null;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The four numbers every capacity row shows, plus the advisory warnings derived from them.
 *
 * `rollup` and `complete` follow RALLY's definition: a child story counts only when its
 * Project AND Release match the plan (Broadcom TechDocs, "View Capacity Plan Details").
 * Rally's model treats Project as the team, so the per-team split translates here to
 * `work_items.team_id`. Without the release filter a Feature whose children span releases
 * would inflate every plan that touches it.
 *
 * `complete` uses COMPLETED_SCHEDULE_STATES while the Portfolio's Percent Done uses
 * ACCEPTED_SCHEDULE_STATES — the D1 distinction in `db/schema/enums.ts`. Do not unify them.
 */
export interface CapacityMetrics {
  /** Child points finished: COMPLETED_SCHEDULE_STATES, not ACCEPTED. */
  complete: number;
  /** Live child points, whatever their state. */
  rollup: number;
  /** Committed demand — SUM(allocation.value). */
  estimated: number;
  /** Entered ceiling, or null when the planner has not entered one. Null ≠ 0. */
  capacity: number | null;
  warnings: CapacityWarning[];
}

/**
 * What the REPOSITORY returns: the row plus the raw numbers needed to resolve a tier.
 *
 * Tier resolution is deliberately NOT done here. `resolveEstimate` needs the Preliminary
 * Estimate mapped into the plan's unit, and that mapping lives in workspace settings which
 * only the service reads — a repository that guessed a preliminary of 0 would report tier
 * "none" for every Feature that has only a T-shirt size.
 */
export interface CapacityAllocationRow extends CapacityAllocation {
  itemKey: string;
  name: string;
  /** Top-down points forecast, already numeric. */
  refined: number | null;
  /** The T-shirt size; the service maps it through workspace settings. */
  preliminarySize: PreliminaryEstimateSize;
  /** SUM(value) over TEAM-ASSIGNED rows for this Feature on this plan. */
  totalAllocated: number;
  rollup: number;
  complete: number;
  /** The Feature's LexoRank — the order Rally's cutline accumulates down. */
  rank: string;
  /** The Feature's own rollup/complete across every team, for the item-level row. */
  itemRollup: number;
  itemComplete: number;
}

/** An allocated Feature as it appears under a team (or in the Unallocated bucket). */
export interface CapacityAllocationView extends CapacityAllocation {
  itemKey: string;
  name: string;
  /** Which tier the Feature's Estimated figure came from, for the UI badge. */
  tier: EstimateTier;
  metrics: CapacityMetrics;
}

export interface CreateCapacityAllocationInput {
  portfolioItemId: string;
  /** Null parks the demand in the Unallocated bucket. */
  teamId?: string | null;
  /**
   * Omit to accept the server's default, which is
   * `defaultAllocationEstimate` — Refined → Preliminary, deliberately SKIPPING the
   * allocated tier so a blank field cannot commit the sum of the allocations it is
   * being used to create.
   */
  value?: number;
}

export interface UpdateCapacityAllocationInput {
  value?: number;
  /** Moving demand between teams, or into/out of the Unallocated bucket. */
  teamId?: string | null;
}
