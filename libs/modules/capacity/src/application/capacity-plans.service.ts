import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ConflictException,
  InjectDrizzle,
  NotFoundException,
  PreconditionFailedException,
} from '@platform';
import type { DrizzleDB, JwtPayload } from '@platform';
import { AccessService } from '@modules/access';
import {
  PortfolioItemsService,
  PreliminaryEstimateMapService,
  computeCapacityWarnings,
  defaultAllocationEstimate,
  resolveEstimate,
} from '@modules/portfolio';
import { releases, teams } from '../../../../../db/schema/work';
import {
  CAPACITY_PLAN_REPOSITORY,
  type ICapacityPlanRepository,
} from '../domain/ports/capacity-plan.repository';
import type { PreliminaryEstimateSize } from '../../../../../db/schema/enums';
import type {
  CapacityAllocationView,
  CapacityMetrics,
  CreateCapacityAllocationInput,
  UpdateCapacityAllocationInput,
} from '../domain/capacity-allocation.types';
import type {
  CapacityPlan,
  CapacityPlanTeam,
  CapacityPlanTeamView,
  CapacityPlanView,
  CreateCapacityPlanInput,
  UpdateCapacityPlanInput,
} from '../domain/capacity-plan.types';

/** A plan team with the four numbers and the advisory warnings derived from them. */
export interface CapacityPlanTeamWithMetrics extends CapacityPlanTeamView {
  metrics: CapacityMetrics;
}

/**
 * Everything one plan's detail surface renders.
 *
 * `unallocated` is reported separately and is deliberately NOT part of any team's demand:
 * an unallocated placeholder must not outrank a Refined or Preliminary forecast, which is
 * the same reason `totalAllocatedFor` counts team-assigned rows only.
 */
export interface CapacityPlanDetail extends Omit<CapacityPlanView, 'teams'> {
  teams: CapacityPlanTeamWithMetrics[];
  allocations: CapacityAllocationView[];
  unallocated: number;
}

@Injectable()
export class CapacityPlansService {
  constructor(
    @Inject(CAPACITY_PLAN_REPOSITORY) private readonly repo: ICapacityPlanRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly access: AccessService,
    private readonly estimateMaps: PreliminaryEstimateMapService,
    private readonly portfolioItems: PortfolioItemsService,
  ) {}

  /**
   * Plans for one project.
   *
   * Authorization is straightforward here, unlike the Portfolio list: a plan belongs to
   * exactly one project and `projectId` is REQUIRED, so the route's guard already checked
   * the caller against it and there is no cross-project filtering to do.
   */
  async listPlans(actor: JwtPayload, projectId: string): Promise<CapacityPlanView[]> {
    return this.repo.listByProject(projectId, actor.workspaceId);
  }

  async getPlan(actor: JwtPayload, id: string): Promise<CapacityPlanView> {
    const plan = await this.repo.findViewById(id, actor.workspaceId);
    if (!plan) throw new NotFoundException('CAPACITY_PLAN_NOT_FOUND', 'Capacity plan not found');
    return plan;
  }

  async createPlan(
    actor: JwtPayload,
    input: Omit<CreateCapacityPlanInput, 'workspaceId'>,
  ): Promise<CapacityPlanView> {
    await this.access.assertProjectPermission(actor, input.projectId, 'capacity:manage');
    await this.assertReleaseInProject(actor.workspaceId, input.projectId, input.releaseId);

    // Checked before inserting so the caller gets a named conflict rather than a raw
    // unique-violation 500. The index is still the real guarantee under a race.
    const existing = await this.repo.findByProjectRelease(
      input.projectId,
      input.releaseId,
      actor.workspaceId,
    );
    if (existing) {
      throw new ConflictException(
        'CAPACITY_PLAN_EXISTS',
        'This release already has a capacity plan',
      );
    }

    const created = await this.repo.create({ ...input, workspaceId: actor.workspaceId });
    return this.getPlan(actor, created.id);
  }

  async updatePlan(
    actor: JwtPayload,
    id: string,
    input: UpdateCapacityPlanInput,
  ): Promise<CapacityPlanView> {
    const plan = await this.requireDraft(actor, id);
    await this.access.assertProjectPermission(actor, plan.projectId, 'capacity:manage');
    await this.repo.update(id, input, actor.workspaceId);
    return this.getPlan(actor, id);
  }

  // ── Teams ─────────────────────────────────────────────────────────────────

  async addTeam(actor: JwtPayload, id: string, teamId: string): Promise<CapacityPlanView> {
    const plan = await this.requireDraft(actor, id);
    await this.access.assertProjectPermission(actor, plan.projectId, 'capacity:manage');
    await this.assertTeamInWorkspace(actor.workspaceId, teamId);

    // `uq_capacity_plan_team` would also catch this; the named error says which team.
    if (await this.repo.findTeam(id, teamId)) {
      throw new ConflictException(
        'CAPACITY_TEAM_ALREADY_ADDED',
        'That team is already on this plan',
      );
    }

    await this.repo.addTeam(id, teamId);
    return this.getPlan(actor, id);
  }

  /**
   * Set or clear a team's capacity.
   *
   * `null` CLEARS it back to "not entered", which is deliberately distinct from `0`:
   * a team with no capacity typed yet must not be reported as fully loaded, and the grid
   * renders blank rather than zero.
   */
  async setTeamCapacity(
    actor: JwtPayload,
    id: string,
    teamId: string,
    capacity: string | null,
  ): Promise<CapacityPlanView> {
    const plan = await this.requireDraft(actor, id);
    await this.access.assertProjectPermission(actor, plan.projectId, 'capacity:manage');
    await this.requirePlanTeam(id, teamId);

    await this.repo.setTeamCapacity(id, teamId, capacity);
    return this.getPlan(actor, id);
  }

  async removeTeam(actor: JwtPayload, id: string, teamId: string): Promise<CapacityPlanView> {
    const plan = await this.requireDraft(actor, id);
    await this.access.assertProjectPermission(actor, plan.projectId, 'capacity:manage');
    await this.requirePlanTeam(id, teamId);

    // Refuse rather than cascade: the allocations are committed demand a planner entered,
    // and silently deleting them would lose work with no undo. Allocations land in the
    // next slice; the guard exists now so it cannot be forgotten then.
    const allocated = await this.repo.countTeamAllocations(id, teamId);
    if (allocated > 0) {
      throw new PreconditionFailedException(
        'CAPACITY_TEAM_HAS_ALLOCATIONS',
        `Move or remove the ${allocated} allocation(s) for this team first`,
      );
    }

    await this.repo.removeTeam(id, teamId);
    return this.getPlan(actor, id);
  }

  // ── Allocations ───────────────────────────────────────────────────────────

  /**
   * Commit demand: this much of this Feature, to this Team (or to the Unallocated bucket).
   *
   * Merges into an existing row for the same (plan, Feature, team) triple rather than
   * creating a second one. Rally models sharing as one row PER TEAM under a Feature, so two
   * rows for the same pair would double-count that team's demand in every total.
   */
  async allocate(
    actor: JwtPayload,
    planId: string,
    input: CreateCapacityAllocationInput,
  ): Promise<CapacityPlanDetail> {
    const plan = await this.requireDraft(actor, planId);
    await this.access.assertProjectPermission(actor, plan.projectId, 'capacity:manage');

    const feature = await this.requireAllocatableFeature(actor, plan, input.portfolioItemId);
    const teamId = input.teamId ?? null;
    if (teamId !== null) await this.requirePlanTeam(planId, teamId);

    const value = await this.resolveAllocationValue(actor, feature, input.value);

    const existing = await this.repo.findAllocationFor(planId, input.portfolioItemId, teamId);
    if (existing) {
      // Adding to what is already committed, not replacing it: the planner asked to
      // allocate more of this Feature to this team.
      const merged = Number(existing.value) + Number(value);
      await this.repo.updateAllocation(existing.id, { value: String(merged) });
    } else {
      await this.repo.createAllocation({
        planId,
        portfolioItemId: input.portfolioItemId,
        teamId,
        value: String(value),
      });
    }

    return this.getPlanDetail(actor, planId);
  }

  async updateAllocation(
    actor: JwtPayload,
    planId: string,
    allocationId: string,
    input: UpdateCapacityAllocationInput,
  ): Promise<CapacityPlanDetail> {
    const plan = await this.requireDraft(actor, planId);
    await this.access.assertProjectPermission(actor, plan.projectId, 'capacity:manage');

    const allocation = await this.repo.findAllocation(allocationId, planId);
    if (!allocation) {
      throw new NotFoundException('CAPACITY_ALLOCATION_NOT_FOUND', 'Allocation not found');
    }
    // Moving to a team requires that team to be ON the plan; moving to null parks it in the
    // Unallocated bucket, which needs no membership.
    if (input.teamId) await this.requirePlanTeam(planId, input.teamId);

    await this.repo.updateAllocation(allocationId, {
      ...(input.value === undefined ? {} : { value: String(input.value) }),
      ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    });
    return this.getPlanDetail(actor, planId);
  }

  async removeAllocation(
    actor: JwtPayload,
    planId: string,
    allocationId: string,
  ): Promise<CapacityPlanDetail> {
    const plan = await this.requireDraft(actor, planId);
    await this.access.assertProjectPermission(actor, plan.projectId, 'capacity:manage');

    const allocation = await this.repo.findAllocation(allocationId, planId);
    if (!allocation) {
      throw new NotFoundException('CAPACITY_ALLOCATION_NOT_FOUND', 'Allocation not found');
    }
    await this.repo.deleteAllocation(allocationId);
    return this.getPlanDetail(actor, planId);
  }

  /**
   * The full plan: teams with their metrics and warnings, plus every allocation.
   *
   * Assembled here rather than in the repository because the tier needs the workspace
   * estimate map and the warnings are pure domain logic — the repository supplies raw
   * numbers, this decides what they mean.
   */
  async getPlanDetail(actor: JwtPayload, id: string): Promise<CapacityPlanDetail> {
    const plan = await this.getPlan(actor, id);
    const map = await this.estimateMaps.forWorkspace(actor.workspaceId);
    const rows = await this.repo.listAllocations(plan);

    const inUnit = (size: PreliminaryEstimateSize) =>
      plan.unit === 'points' ? map[size].points : map[size].count;

    const allocations: CapacityAllocationView[] = rows.map((row) => {
      const resolved = resolveEstimate({
        totalAllocated: row.totalAllocated,
        refined: row.refined,
        preliminary: inUnit(row.preliminarySize),
      });
      return {
        id: row.id,
        planId: row.planId,
        portfolioItemId: row.portfolioItemId,
        teamId: row.teamId,
        value: row.value,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        itemKey: row.itemKey,
        name: row.name,
        tier: resolved.tier,
        metrics: {
          complete: row.complete,
          rollup: row.rollup,
          estimated: Number(row.value),
          // A Feature row has no capacity of its own — the ceiling belongs to the team.
          capacity: null,
          warnings: computeCapacityWarnings({
            kind: 'feature',
            rollup: row.rollup,
            estimated: Number(row.value),
            capacity: null,
            // Carries Rally's "Feature Missing Estimate Error": tier `none` means no
            // allocation, no refined forecast and no preliminary mapping, so there is
            // nothing to plan this Feature against.
            tier: resolved.tier,
          }),
        },
      };
    });

    const teams = await Promise.all(
      plan.teams.map(async (team) => {
        const { complete, rollup } = await this.repo.teamMetrics(plan, team.teamId);
        const estimated = allocations
          .filter((a) => a.teamId === team.teamId)
          .reduce((sum, a) => sum + Number(a.value), 0);
        const capacity = team.capacity === null ? null : Number(team.capacity);
        return {
          ...team,
          metrics: {
            complete,
            rollup,
            estimated,
            capacity,
            warnings: computeCapacityWarnings({
              kind: 'team',
              rollup,
              estimated,
              capacity,
              targetLoadPct: plan.targetLoadPct,
            }),
          },
        };
      }),
    );

    return {
      ...plan,
      teams,
      allocations,
      /** Demand parked without a team. Excluded from Total Allocated by design. */
      unallocated: allocations
        .filter((a) => a.teamId === null)
        .reduce((sum, a) => sum + Number(a.value), 0),
    };
  }

  /**
   * The value a blank Estimate field commits.
   *
   * Uses `defaultAllocationEstimate`, which DELIBERATELY skips the allocated tier — the
   * subtlest rule in Phase 5. Folding allocations back in would mean a blank field commits
   * the sum of the very allocations it is being used to create.
   */
  private async resolveAllocationValue(
    actor: JwtPayload,
    feature: { refinedEstimate: string | null; preliminaryEstimate: PreliminaryEstimateSize },
    supplied: number | undefined,
  ): Promise<number> {
    if (supplied !== undefined) return supplied;
    const map = await this.estimateMaps.forWorkspace(actor.workspaceId);
    const size = map[feature.preliminaryEstimate];
    return defaultAllocationEstimate({
      refined: feature.refinedEstimate === null ? null : Number(feature.refinedEstimate),
      preliminary: size.points,
    }).value;
  }

  /**
   * The allocation target must be a FEATURE in the plan's own project.
   *
   * Epics are not allocatable: only the lowest portfolio level attaches to the story
   * hierarchy, so an Epic has no children of its own to roll up and allocating to it would
   * produce a row whose Rollup is permanently zero.
   */
  private async requireAllocatableFeature(
    actor: JwtPayload,
    plan: CapacityPlan,
    portfolioItemId: string,
  ) {
    const item = await this.portfolioItems.getItem(actor, portfolioItemId);
    if (item.type !== 'feature') {
      throw new PreconditionFailedException(
        'CAPACITY_ALLOCATION_NOT_FEATURE',
        'Only a Feature can be allocated — an Epic rolls up through its Features',
      );
    }
    if (item.projectId !== plan.projectId) {
      throw new PreconditionFailedException(
        'CAPACITY_PLAN_RELEASE_MISMATCH',
        'That Feature belongs to a different project',
      );
    }
    return item;
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  /**
   * Load the plan and refuse if it is published.
   *
   * A published plan has written Release and planned dates onto Features, so editing it
   * in place would leave those writes describing a plan that no longer exists. Reverting
   * to draft is the supported route and arrives with the publish slice — until then
   * nothing can reach `published`, so this guard is proven by an e2e that inserts one
   * directly rather than by the UI.
   */
  private async requireDraft(actor: JwtPayload, id: string): Promise<CapacityPlan> {
    const plan = await this.repo.findById(id, actor.workspaceId);
    if (!plan) throw new NotFoundException('CAPACITY_PLAN_NOT_FOUND', 'Capacity plan not found');
    if (plan.status !== 'draft') {
      throw new PreconditionFailedException(
        'CAPACITY_PLAN_NOT_DRAFT',
        'A published plan is read-only; revert it to draft first',
      );
    }
    return plan;
  }

  private async requirePlanTeam(planId: string, teamId: string): Promise<CapacityPlanTeam> {
    const planTeam = await this.repo.findTeam(planId, teamId);
    if (!planTeam) {
      throw new NotFoundException('CAPACITY_TEAM_NOT_FOUND', 'That team is not on this plan');
    }
    return planTeam;
  }

  /**
   * The release must belong to the plan's project.
   *
   * `capacity_plans.release_id` carries no foreign key, and a release from another project
   * would make the plan describe a timebox outside its own scope — while still looking
   * correct, because the join would resolve a name.
   */
  private async assertReleaseInProject(
    workspaceId: string,
    projectId: string,
    releaseId: string,
  ): Promise<void> {
    const rows = await this.db
      .select({ id: releases.id })
      .from(releases)
      .where(
        and(
          eq(releases.id, releaseId),
          eq(releases.workspaceId, workspaceId),
          eq(releases.projectId, projectId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new PreconditionFailedException(
        'CAPACITY_PLAN_RELEASE_MISMATCH',
        'Release not found in this project',
      );
    }
  }

  private async assertTeamInWorkspace(workspaceId: string, teamId: string): Promise<void> {
    const rows = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId)))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('CAPACITY_TEAM_NOT_FOUND', 'Team not found');
    }
  }
}
