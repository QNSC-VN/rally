import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DbExecutor, DrizzleDB } from '@platform';
import {
  capacityPlanAllocations,
  capacityPlanTeams,
  capacityPlans,
  projects,
  releases,
  teams,
} from '../../../../../../db/schema/work';
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
