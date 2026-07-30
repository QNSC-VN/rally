import type { CapacityPlanStatus, CapacityPlanUnit } from '../../../../../db/schema/enums';

/**
 * A capacity plan — one per (project, release), enforced by
 * `uq_capacity_plan_project_release`.
 *
 * NOT to be confused with `work.member_capacity`, which is P3.1 Team Status: per-member
 * HOURS inside one iteration. This is per-TEAM capacity in the plan's own unit across a
 * whole release, typed by a planner. Nothing derives it automatically — the forecast
 * action (slice 6) only proposes values a planner may edit.
 *
 * Numeric columns arrive as STRINGS from Drizzle (numeric precision is preserved), so
 * `capacity` is a string here and converts at the DTO boundary.
 */
export interface CapacityPlan {
  id: string;
  workspaceId: string;
  projectId: string;
  releaseId: string;
  name: string;
  status: CapacityPlanStatus;
  /**
   * Points or count. Chosen at creation and FIXED afterwards: every number on the plan,
   * including each allocation value, is expressed in it, so changing it would silently
   * reinterpret existing demand rather than convert it.
   */
  unit: CapacityPlanUnit;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /**
   * Advisory load ceiling below 100%. Rally's guidance is to leave headroom for unplanned
   * work, so a team at 95% warrants a warning even though it is not over capacity. Never
   * blocks an action.
   */
  targetLoadPct: number;
  publishedAt: Date | null;
  publishedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A team participating in a plan, with the capacity a planner typed for it. */
export interface CapacityPlanTeam {
  id: string;
  planId: string;
  teamId: string;
  /**
   * In the plan's unit. `null` means "not entered yet", which is NOT zero capacity — the
   * grid renders it blank, and a warning rule must not treat it as a real ceiling of 0.
   */
  capacity: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A plan team plus the display fields the grid needs. */
export interface CapacityPlanTeamView extends CapacityPlanTeam {
  teamName: string | null;
}

/** A plan plus everything its detail surface renders in ONE response. */
export interface CapacityPlanView extends CapacityPlan {
  releaseName: string | null;
  projectName: string | null;
  teams: CapacityPlanTeamView[];
  /**
   * Summed team capacity, or null when NO team has a capacity yet.
   *
   * Null rather than 0 for the same reason a team's own capacity is nullable: a plan
   * where nobody has typed anything is not a plan with zero capacity, and the summary
   * must say so rather than imply everything is over budget.
   */
  totalCapacity: string | null;
}

export interface CreateCapacityPlanInput {
  workspaceId: string;
  projectId: string;
  releaseId: string;
  name: string;
  unit: CapacityPlanUnit;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  targetLoadPct?: number;
}

/**
 * What a planner may change on an existing plan.
 *
 * `unit`, `projectId` and `releaseId` are absent deliberately: the unit reinterprets
 * every stored allocation, and the (project, release) pair is the plan's identity under
 * `uq_capacity_plan_project_release`.
 */
export interface UpdateCapacityPlanInput {
  name?: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  targetLoadPct?: number;
}
