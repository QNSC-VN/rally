import type { DbExecutor } from '@platform';
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

  /**
   * Allocations currently pointing at a team on this plan.
   *
   * Removing a team must not orphan its committed demand, so the service refuses while
   * this is non-zero. Allocations arrive in the next slice; the guard lives here now so
   * the rule cannot be forgotten once they do.
   */
  countTeamAllocations(planId: string, teamId: string): Promise<number>;
}
