import type { PortfolioItemState, PreliminaryEstimateSize } from '../../../../../db/schema/enums';
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
  /**
   * This allocation's team is the Feature's PRIMARY assignment on this plan — Rally's "Planned
   * Project Assignment". At most one per (plan, Feature), enforced by a partial unique index, and
   * never true for an Unallocated row.
   */
  isPrimary: boolean;
  /**
   * The points a planner explicitly allocated to this team, or NULL for "not explicitly
   * allocated".
   *
   * Rally's model: an item is ASSIGNED to one primary team, and points are ALLOCATED to the
   * additional ones. The primary assignment carries no number of its own — the item's estimate is
   * what the plan charges there — so Rally's `Allocation` column is blank on those rows. Null
   * carries that state; the read path resolves it through `resolveEstimate`.
   */
  value: string | null;
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
  /** The Feature's own workflow state — Rally's `State` column on the nested table. */
  state: PortfolioItemState;
  /** The Feature's own rollup/complete across every team, for the item-level row. */
  itemRollup: number;
  itemComplete: number;
  /** The project the Feature itself belongs to — Rally's "Project" column. */
  itemProjectId: string;
  itemProjectName: string | null;
  /** Set when the Feature has been archived — an archived item is not planning demand. */
  itemArchivedAt: Date | null;
  /**
   * The Feature's OWN release, which is not always the plan's.
   *
   * Read by `Move To Another Plan`: a Feature committed to another release cannot be planned
   * against this one, so the dialog has to know before it offers the move.
   */
  itemReleaseId: string | null;
}

/** An allocated Feature as it appears under a team (or in the Unallocated bucket). */
export interface CapacityAllocationView extends CapacityAllocation {
  itemKey: string;
  name: string;
  /** Which tier the Feature's Estimated figure came from, for the UI badge. */
  tier: EstimateTier;
  /**
   * The Feature's LexoRank, so the nested table can show the same `Rank` column the plan's item
   * list does. Rally's sub-table leads with it: a planner reading one team's Features still wants
   * to know where each sits in the plan's priority order.
   */
  rank: string;
  /** The Feature's own workflow state (Rally's `State` column on the sub-table). */
  state: PortfolioItemState;
  /**
   * The Feature's OWN project, for Rally's `Allocation` column: it prints `← from <project>` when
   * the Feature belongs somewhere other than the plan's project, and nothing when it is native.
   */
  projectId: string;
  projectName: string | null;
  /**
   * The Feature is ARCHIVED, so this row contributes nothing to the plan's numbers.
   *
   * The row is still returned rather than hidden: it is the only way a planner can see the stale
   * commitment and remove it. The BA says an archived item is not planning demand — which is about
   * the arithmetic, not about concealing the row.
   */
  archived: boolean;
  /**
   * All THREE candidate estimates, so the row's trailing glyph can show Rally's `Estimate` tooltip:
   * Allocated / Refined / Preliminary, with the one in force ticked.
   *
   * Sent as the raw candidates rather than as the winner alone because the tooltip's whole job is
   * showing what was NOT used — a planner checking whether 60 is a commitment or a T-shirt size is
   * comparing the three.
   */
  estimateBreakdown: {
    /** What a planner explicitly allocated to this team; null when they only assigned it. */
    allocated: number | null;
    /** Top-down forecast on the Feature. */
    refined: number | null;
    /** T-shirt size mapped through workspace settings, in the plan's unit. */
    preliminary: number | null;
  };
  metrics: CapacityMetrics;
}

export interface CreateCapacityAllocationInput {
  portfolioItemId: string;
  /** Null parks the demand in the Unallocated bucket. */
  teamId?: string | null;
  /**
   * Points explicitly allocated to this team. OMIT to assign without allocating, which stores NULL
   * and charges the Feature's own estimate here — Rally's primary assignment.
   */
  value?: number;
}

export interface UpdateCapacityAllocationInput {
  /**
   * `null` CLEARS the explicit allocation, returning the row to charging the Feature's estimate.
   * `undefined` leaves it alone, so an emptied cell has to send null on purpose.
   */
  value?: number | null;
  /** Moving demand between teams, or into/out of the Unallocated bucket. */
  teamId?: string | null;
}
