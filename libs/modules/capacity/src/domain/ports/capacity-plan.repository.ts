import type { DbExecutor } from '@platform';
import type { CapacityAllocation, CapacityAllocationRow } from '../capacity-allocation.types';
import type {
  CapacityPlan,
  CapacityPlanTeam,
  CapacityPlanView,
  CreateCapacityPlanInput,
  UpdateCapacityPlanInput,
} from '../capacity-plan.types';

export const CAPACITY_PLAN_REPOSITORY = Symbol('CAPACITY_PLAN_REPOSITORY');

export interface ICapacityPlanRepository {
  findById(id: string, workspaceId: string): Promise<CapacityPlan | null>;

  /**
   * The detail surface: plan + release/project names + every team, in ONE round trip.
   *
   * The grid shows a row per team with capacity alongside plan totals; fetching teams
   * per row would make a plan with ten teams eleven requests.
   */
  findViewById(id: string, workspaceId: string): Promise<CapacityPlanView | null>;

  /**
   * Plans for a project, newest first.
   *
   * Not paginated: a plan is per (project, release), so the count is bounded by the
   * project's releases — tens, not thousands. Adding a cursor here would be scaffolding
   * for a scale this table cannot reach.
   */
  listByProject(projectId: string, workspaceId: string): Promise<CapacityPlanView[]>;

  /** The existing plan for a (project, release) pair, for the uniqueness pre-check. */
  findByProjectRelease(
    projectId: string,
    releaseId: string,
    workspaceId: string,
  ): Promise<CapacityPlan | null>;

  create(input: CreateCapacityPlanInput, executor?: DbExecutor): Promise<CapacityPlan>;

  update(
    id: string,
    input: UpdateCapacityPlanInput,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<CapacityPlan>;

  // ── Teams on a plan ────────────────────────────────────────────────────────

  findTeam(planId: string, teamId: string): Promise<CapacityPlanTeam | null>;

  addTeam(planId: string, teamId: string, executor?: DbExecutor): Promise<CapacityPlanTeam>;

  /** `capacity` may be null — "not entered", which is not the same as zero. */
  setTeamCapacity(
    planId: string,
    teamId: string,
    capacity: string | null,
    executor?: DbExecutor,
  ): Promise<CapacityPlanTeam>;

  removeTeam(planId: string, teamId: string, executor?: DbExecutor): Promise<void>;

  // ── Allocations ────────────────────────────────────────────────────────────

  /**
   * Every allocation on a plan with its per-row metrics, in ONE round trip.
   *
   * Returns rows rather than finished views: the tier needs the Preliminary Estimate
   * mapped through workspace settings, which is the service's job.
   */
  listAllocations(plan: CapacityPlan): Promise<CapacityAllocationRow[]>;

  findAllocation(id: string, planId: string): Promise<CapacityAllocation | null>;

  /** An existing allocation for the same (plan, item, team) triple, for the merge check. */
  findAllocationFor(
    planId: string,
    portfolioItemId: string,
    teamId: string | null,
  ): Promise<CapacityAllocation | null>;

  createAllocation(
    input: { planId: string; portfolioItemId: string; teamId: string | null; value: string },
    executor?: DbExecutor,
  ): Promise<CapacityAllocation>;

  updateAllocation(
    id: string,
    input: { value?: string; teamId?: string | null },
    executor?: DbExecutor,
  ): Promise<CapacityAllocation>;

  deleteAllocation(id: string, executor?: DbExecutor): Promise<void>;

  /**
   * SUM(value) for one Feature on one plan, counting ONLY rows assigned to a team.
   *
   * Feeds `resolveEstimate`'s allocated tier. Unallocated rows are excluded because an
   * unallocated placeholder must not outrank a Refined or Preliminary forecast — see the
   * `capacity_plan_allocations` comment in `db/schema/work.ts`.
   */
  totalAllocatedFor(planId: string, portfolioItemId: string): Promise<number>;

  /** Per-team Complete/Rollup, following Rally's project+release+team child filter. */
  teamMetrics(plan: CapacityPlan, teamId: string): Promise<{ complete: number; rollup: number }>;

  /**
   * Allocations currently pointing at a team on this plan.
   *
   * Removing a team must not orphan its committed demand, so the service refuses while
   * this is non-zero. Allocations arrive in the next slice; the guard lives here now so
   * the rule cannot be forgotten once they do.
   */
  countTeamAllocations(planId: string, teamId: string): Promise<number>;
}
