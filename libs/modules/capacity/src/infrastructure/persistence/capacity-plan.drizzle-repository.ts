import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DbExecutor, DrizzleDB } from '@platform';
import {
  capacityPlanAllocations,
  capacityPlanTeams,
  capacityPlans,
  portfolioItems,
  projects,
  releases,
  teams,
  workItems,
} from '../../../../../../db/schema/work';
import { childWorkPredicate, metricSubqueries } from './capacity-metrics.sql';
import { completedScheduleStatesSql } from '../../../../../../db/schema/enums';
import type {
  CapacityAllocation,
  CapacityAllocationRow,
} from '../../domain/capacity-allocation.types';
import type {
  CapacityPlan,
  CapacityPlanTeam,
  CapacityPlanTeamView,
  CapacityPlanView,
  CreateCapacityPlanInput,
  UpdateCapacityPlanInput,
} from '../../domain/capacity-plan.types';
import type { ICapacityPlanRepository } from '../../domain/ports/capacity-plan.repository';

@Injectable()
export class CapacityPlanDrizzleRepository implements ICapacityPlanRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string, workspaceId: string): Promise<CapacityPlan | null> {
    const rows = await this.db
      .select()
      .from(capacityPlans)
      .where(and(eq(capacityPlans.id, id), eq(capacityPlans.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ? this.mapPlan(rows[0]) : null;
  }

  async findByProjectRelease(
    projectId: string,
    releaseId: string,
    workspaceId: string,
  ): Promise<CapacityPlan | null> {
    const rows = await this.db
      .select()
      .from(capacityPlans)
      .where(
        and(
          eq(capacityPlans.projectId, projectId),
          eq(capacityPlans.releaseId, releaseId),
          eq(capacityPlans.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapPlan(rows[0]) : null;
  }

  async findViewById(id: string, workspaceId: string): Promise<CapacityPlanView | null> {
    const views = await this.selectViews(
      and(eq(capacityPlans.id, id), eq(capacityPlans.workspaceId, workspaceId)),
    );
    return views[0] ?? null;
  }

  async listByProject(projectId: string, workspaceId: string): Promise<CapacityPlanView[]> {
    return this.selectViews(
      and(eq(capacityPlans.projectId, projectId), eq(capacityPlans.workspaceId, workspaceId)),
    );
  }

  async create(input: CreateCapacityPlanInput, executor?: DbExecutor): Promise<CapacityPlan> {
    const exec = executor ?? this.db;
    const rows = await exec
      .insert(capacityPlans)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        releaseId: input.releaseId,
        name: input.name,
        unit: input.unit,
        plannedStartDate: input.plannedStartDate ?? null,
        plannedEndDate: input.plannedEndDate ?? null,
        ...(input.targetLoadPct === undefined ? {} : { targetLoadPct: input.targetLoadPct }),
      })
      .returning();
    return this.mapPlan(rows[0]);
  }

  async update(
    id: string,
    input: UpdateCapacityPlanInput,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<CapacityPlan> {
    const exec = executor ?? this.db;
    // Assigned key-by-key: `undefined` means "leave alone" while `null` clears a date, so
    // spreading the input would write nulls over columns the caller never mentioned.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.plannedStartDate !== undefined) set.plannedStartDate = input.plannedStartDate;
    if (input.plannedEndDate !== undefined) set.plannedEndDate = input.plannedEndDate;
    if (input.targetLoadPct !== undefined) set.targetLoadPct = input.targetLoadPct;

    const rows = await exec
      .update(capacityPlans)
      .set(set)
      .where(and(eq(capacityPlans.id, id), eq(capacityPlans.workspaceId, workspaceId)))
      .returning();
    return this.mapPlan(rows[0]);
  }

  // ── Teams ─────────────────────────────────────────────────────────────────

  async findTeam(planId: string, teamId: string): Promise<CapacityPlanTeam | null> {
    const rows = await this.db
      .select()
      .from(capacityPlanTeams)
      .where(and(eq(capacityPlanTeams.planId, planId), eq(capacityPlanTeams.teamId, teamId)))
      .limit(1);
    return rows[0] ? this.mapTeam(rows[0]) : null;
  }

  async addTeam(planId: string, teamId: string, executor?: DbExecutor): Promise<CapacityPlanTeam> {
    const exec = executor ?? this.db;
    // Capacity is left NULL: joining a plan is not the same as having a capacity of zero,
    // and the grid renders the difference.
    const rows = await exec.insert(capacityPlanTeams).values({ planId, teamId }).returning();
    return this.mapTeam(rows[0]);
  }

  async setTeamCapacity(
    planId: string,
    teamId: string,
    capacity: string | null,
    executor?: DbExecutor,
  ): Promise<CapacityPlanTeam> {
    const exec = executor ?? this.db;
    const rows = await exec
      .update(capacityPlanTeams)
      .set({ capacity, updatedAt: new Date() })
      .where(and(eq(capacityPlanTeams.planId, planId), eq(capacityPlanTeams.teamId, teamId)))
      .returning();
    return this.mapTeam(rows[0]);
  }

  async removeTeam(planId: string, teamId: string, executor?: DbExecutor): Promise<void> {
    const exec = executor ?? this.db;
    await exec
      .delete(capacityPlanTeams)
      .where(and(eq(capacityPlanTeams.planId, planId), eq(capacityPlanTeams.teamId, teamId)));
  }

  // ── Allocations ───────────────────────────────────────────────────────────

  async listAllocations(plan: CapacityPlan): Promise<CapacityAllocationRow[]> {
    // ONE round trip. Each metric is a correlated subquery — the same shape the portfolio
    // repository uses for its rollups — because the architecture doc is explicit that a
    // per-row fetch here would make the page unusable.
    //
    // The child filter is Rally's: project AND release must match the plan, and the team
    // narrows it when the row is assigned (Rally attributes by Project, which is its team).
    // An Unallocated row has no team, so it counts every matching child of the Feature.
    const childScope = sql`
      ${workItems.projectId} = ${plan.projectId}
      and ${workItems.releaseId} = ${plan.releaseId}
      and ${workItems.deletedAt} is null
      and ${workItems.featureId} = ${capacityPlanAllocations.portfolioItemId}
      and (
        ${capacityPlanAllocations.teamId} is null
        or ${workItems.teamId} = ${capacityPlanAllocations.teamId}
      )`;

    const rows = await this.db
      .select({
        alloc: capacityPlanAllocations,
        itemKey: portfolioItems.itemKey,
        name: portfolioItems.name,
        refinedEstimate: portfolioItems.refinedEstimate,
        preliminaryEstimate: portfolioItems.preliminaryEstimate,
        rollup: sql<string>`(
          select coalesce(sum(${workItems.storyPoints}), 0)
          from ${workItems} where ${childScope}
        )`,
        complete: sql<string>`(
          select coalesce(sum(${workItems.storyPoints}) filter (
            where ${workItems.scheduleState} in (${completedScheduleStatesSql()})
          ), 0)
          from ${workItems} where ${childScope}
        )`,
        // SUM over TEAM-ASSIGNED rows only: an Unallocated placeholder must not outrank a
        // Refined or Preliminary forecast in `resolveEstimate`.
        totalAllocated: sql<string>`(
          select coalesce(sum(a2.value), 0)
          from ${capacityPlanAllocations} a2
          where a2.plan_id = ${capacityPlanAllocations.planId}
            and a2.portfolio_item_id = ${capacityPlanAllocations.portfolioItemId}
            and a2.team_id is not null
        )`,
      })
      .from(capacityPlanAllocations)
      .innerJoin(portfolioItems, eq(portfolioItems.id, capacityPlanAllocations.portfolioItemId))
      .where(eq(capacityPlanAllocations.planId, plan.id))
      // Unallocated last, then by Feature key, with `id` as the unique tiebreaker the
      // ordering ratchet requires.
      .orderBy(
        asc(sql`${capacityPlanAllocations.teamId} is null`),
        asc(portfolioItems.itemKey),
        asc(capacityPlanAllocations.id),
      );

    return rows.map((row) => ({
      ...this.mapAllocation(row.alloc),
      itemKey: row.itemKey,
      name: row.name,
      refined: row.refinedEstimate === null ? null : Number(row.refinedEstimate),
      preliminarySize: row.preliminaryEstimate,
      totalAllocated: Number(row.totalAllocated),
      rollup: Number(row.rollup),
      complete: Number(row.complete),
    }));
  }

  async findAllocation(id: string, planId: string): Promise<CapacityAllocation | null> {
    const rows = await this.db
      .select()
      .from(capacityPlanAllocations)
      .where(and(eq(capacityPlanAllocations.id, id), eq(capacityPlanAllocations.planId, planId)))
      .limit(1);
    return rows[0] ? this.mapAllocation(rows[0]) : null;
  }

  async findAllocationFor(
    planId: string,
    portfolioItemId: string,
    teamId: string | null,
  ): Promise<CapacityAllocation | null> {
    const rows = await this.db
      .select()
      .from(capacityPlanAllocations)
      .where(
        and(
          eq(capacityPlanAllocations.planId, planId),
          eq(capacityPlanAllocations.portfolioItemId, portfolioItemId),
          // `= null` never matches in SQL, so the Unallocated bucket needs IS NULL.
          teamId === null
            ? isNull(capacityPlanAllocations.teamId)
            : eq(capacityPlanAllocations.teamId, teamId),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapAllocation(rows[0]) : null;
  }

  async createAllocation(
    input: { planId: string; portfolioItemId: string; teamId: string | null; value: string },
    executor?: DbExecutor,
  ): Promise<CapacityAllocation> {
    const exec = executor ?? this.db;
    const rows = await exec.insert(capacityPlanAllocations).values(input).returning();
    return this.mapAllocation(rows[0]);
  }

  async updateAllocation(
    id: string,
    input: { value?: string; teamId?: string | null },
    executor?: DbExecutor,
  ): Promise<CapacityAllocation> {
    const exec = executor ?? this.db;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.value !== undefined) set.value = input.value;
    // `undefined` leaves the team alone; `null` moves the row to the Unallocated bucket.
    if (input.teamId !== undefined) set.teamId = input.teamId;

    const rows = await exec
      .update(capacityPlanAllocations)
      .set(set)
      .where(eq(capacityPlanAllocations.id, id))
      .returning();
    return this.mapAllocation(rows[0]);
  }

  async deleteAllocation(id: string, executor?: DbExecutor): Promise<void> {
    const exec = executor ?? this.db;
    await exec.delete(capacityPlanAllocations).where(eq(capacityPlanAllocations.id, id));
  }

  async totalAllocatedFor(planId: string, portfolioItemId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${capacityPlanAllocations.value}), 0)` })
      .from(capacityPlanAllocations)
      .where(
        and(
          eq(capacityPlanAllocations.planId, planId),
          eq(capacityPlanAllocations.portfolioItemId, portfolioItemId),
          // Team-assigned rows ONLY: an unallocated placeholder must not outrank a
          // Refined or Preliminary forecast in `resolveEstimate`.
          isNotNull(capacityPlanAllocations.teamId),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  async teamMetrics(
    plan: CapacityPlan,
    teamId: string,
  ): Promise<{ complete: number; rollup: number }> {
    const where = childWorkPredicate({
      projectId: plan.projectId,
      releaseId: plan.releaseId,
      teamId,
      planId: plan.id,
    });
    const m = metricSubqueries(where);
    const [row] = await this.db
      .select({ rollup: m.rollup, complete: m.complete })
      .from(capacityPlans)
      .where(eq(capacityPlans.id, plan.id))
      .limit(1);
    return { rollup: Number(row?.rollup ?? 0), complete: Number(row?.complete ?? 0) };
  }

  private mapAllocation(row: typeof capacityPlanAllocations.$inferSelect): CapacityAllocation {
    return {
      id: row.id,
      planId: row.planId,
      portfolioItemId: row.portfolioItemId,
      teamId: row.teamId,
      value: row.value,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async countTeamAllocations(planId: string, teamId: string): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(capacityPlanAllocations)
      .where(
        and(eq(capacityPlanAllocations.planId, planId), eq(capacityPlanAllocations.teamId, teamId)),
      );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * The one select both read surfaces share, so list and detail cannot drift.
   *
   * Teams come back in a SECOND query keyed by the plan ids rather than as a join: a join
   * would repeat every plan column per team and force de-duplication in JS, and the team
   * count per plan is small enough that two round trips beat that.
   */
  private async selectViews(where: SQL | undefined): Promise<CapacityPlanView[]> {
    const planRows = await this.db
      .select({
        plan: capacityPlans,
        releaseName: releases.name,
        projectName: projects.name,
      })
      .from(capacityPlans)
      .leftJoin(releases, eq(releases.id, capacityPlans.releaseId))
      .leftJoin(projects, eq(projects.id, capacityPlans.projectId))
      .where(where)
      // Newest first, with `id` as the tiebreaker that makes the order total —
      // `query-ordering.ratchet.spec.ts` enforces a unique final column repo-wide.
      .orderBy(desc(capacityPlans.createdAt), asc(capacityPlans.id));

    if (planRows.length === 0) return [];

    const planIds = planRows.map((r) => r.plan.id);
    const teamRows = await this.db
      .select({ team: capacityPlanTeams, teamName: teams.name })
      .from(capacityPlanTeams)
      .leftJoin(teams, eq(teams.id, capacityPlanTeams.teamId))
      .where(inArray(capacityPlanTeams.planId, planIds))
      .orderBy(asc(capacityPlanTeams.createdAt), asc(capacityPlanTeams.id));

    const byPlan = new Map<string, CapacityPlanTeamView[]>();
    for (const row of teamRows) {
      const list = byPlan.get(row.team.planId) ?? [];
      list.push({ ...this.mapTeam(row.team), teamName: row.teamName });
      byPlan.set(row.team.planId, list);
    }

    return planRows.map((row) => {
      const planTeams = byPlan.get(row.plan.id) ?? [];
      return {
        ...this.mapPlan(row.plan),
        releaseName: row.releaseName,
        projectName: row.projectName,
        teams: planTeams,
        totalCapacity: sumCapacity(planTeams),
      };
    });
  }

  private mapPlan(row: typeof capacityPlans.$inferSelect): CapacityPlan {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      releaseId: row.releaseId,
      name: row.name,
      status: row.status,
      unit: row.unit,
      plannedStartDate: row.plannedStartDate,
      plannedEndDate: row.plannedEndDate,
      targetLoadPct: row.targetLoadPct,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapTeam(row: typeof capacityPlanTeams.$inferSelect): CapacityPlanTeam {
    return {
      id: row.id,
      planId: row.planId,
      teamId: row.teamId,
      capacity: row.capacity,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * Sum of the team capacities that have actually been entered.
 *
 * Returns null when NONE has been, rather than 0: "nobody has typed a capacity" and
 * "every team has zero capacity" are different states, and only the second one means the
 * plan is genuinely full. Kept out of SQL so the null-vs-zero rule lives in one readable
 * place instead of a `sum(...) filter (...)` expression.
 */
function sumCapacity(planTeams: CapacityPlanTeamView[]): string | null {
  const entered = planTeams.filter((t) => t.capacity !== null);
  if (entered.length === 0) return null;
  const total = entered.reduce((sum, t) => sum + Number(t.capacity), 0);
  return total.toFixed(2);
}
