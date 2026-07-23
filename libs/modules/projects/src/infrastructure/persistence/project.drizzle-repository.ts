import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import {
  projects,
  projectCounters,
  projectMembers,
  projectTeams,
  workItems,
  workflowStatuses,
  iterations,
} from '../../../../../../db/schema/work';
import type { WorkItemType } from '../../domain/ports/project.repository';
import { users } from '../../../../../../db/schema/identity';
import type {
  Project,
  ProjectWithStats,
  ProjectHealth,
  CreateProjectInput,
  UpdateProjectInput,
} from '../../domain/project.types';
import { IProjectRepository } from '../../domain/ports/project.repository';

@Injectable()
export class ProjectDrizzleRepository implements IProjectRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string, workspaceId: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    return (rows[0] as Project | undefined) ?? null;
  }

  async findByKey(workspaceId: string, key: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.key, key),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    return (rows[0] as Project | undefined) ?? null;
  }

  async listByWorkspace(
    workspaceId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Project>> {
    const conditions = [eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)];

    if (cursor) {
      conditions.push(lt(projects.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(projects.createdAt)
      .limit(limit + 1);

    return buildPageResult(rows as Project[], limit, (p) => [p.createdAt.toISOString()]);
  }

  async listByWorkspaceWithStats(
    workspaceId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<ProjectWithStats>> {
    const conditions = [eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)];

    if (cursor) {
      conditions.push(lt(projects.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(projects.createdAt)
      .limit(limit + 1);

    const page = buildPageResult(rows as Project[], limit, (p) => [p.createdAt.toISOString()]);

    if (page.data.length === 0) {
      return { ...page, data: [] };
    }

    // Count active members per project (no N+1: single query)
    const projectIds = page.data.map((p) => p.id);
    const memberCountRows = await this.db
      .select({
        projectId: projectMembers.projectId,
        count: sql<number>`SUM(CASE WHEN ${projectMembers.status} = 'active' THEN 1 ELSE 0 END)::int`,
      })
      .from(projectMembers)
      .where(inArray(projectMembers.projectId, projectIds))
      .groupBy(projectMembers.projectId);

    const countMap: Record<string, number> = {};
    for (const row of memberCountRows) {
      countMap[row.projectId] = row.count;
    }

    // Count linked active teams per project (no N+1: single query)
    const teamCountRows = await this.db
      .select({
        projectId: projectTeams.projectId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(projectTeams)
      .where(and(inArray(projectTeams.projectId, projectIds), eq(projectTeams.status, 'active')))
      .groupBy(projectTeams.projectId);

    const teamCountMap: Record<string, number> = {};
    for (const row of teamCountRows) {
      teamCountMap[row.projectId] = row.count;
    }

    // Resolve lead display names (no N+1: single query)
    const leadIds = [
      ...new Set(page.data.map((p) => p.leadId).filter((id): id is string => id != null)),
    ];
    const leadNameMap: Record<string, string> = {};
    if (leadIds.length > 0) {
      const leadRows = await this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, leadIds));
      for (const u of leadRows) {
        leadNameMap[u.id] = u.displayName;
      }
    }

    return {
      ...page,
      data: page.data.map((p) => ({
        ...p,
        memberCount: countMap[p.id] ?? 0,
        teamCount: teamCountMap[p.id] ?? 0,
        leadName: p.leadId != null ? (leadNameMap[p.leadId] ?? null) : null,
      })),
    };
  }

  /**
   * Bounded, attention-sorted per-project health rollup for the Home widget.
   * Computed with a fixed, small set of batched queries (active projects, one
   * grouped work-item aggregate, committed iterations, lead names) — NOT one
   * query per project — so cost is independent of project count.
   */
  async listHealthByWorkspace(
    workspaceId: string,
    { limit }: { limit: number },
  ): Promise<ProjectHealth[]> {
    // 1. Active projects in the workspace.
    const projectRows = await this.db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        leadId: projects.leadId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.status, 'active'),
          isNull(projects.deletedAt),
        ),
      );
    if (projectRows.length === 0) return [];

    // 2. Work-item rollup per project — ONE grouped query over the workspace.
    //    "done" is the workflow-status category (matches the grid's definition).
    const aggRows = await this.db
      .select({
        projectId: workItems.projectId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`sum(case when ${workflowStatuses.category} = 'done' then 1 else 0 end)::int`,
        openDefects: sql<number>`sum(case when ${workItems.type} = 'defect' and ${workflowStatuses.category} <> 'done' then 1 else 0 end)::int`,
        blocked: sql<number>`sum(case when ${workItems.isBlocked} then 1 else 0 end)::int`,
      })
      .from(workItems)
      .innerJoin(workflowStatuses, eq(workflowStatuses.id, workItems.statusId))
      .where(and(eq(workItems.workspaceId, workspaceId), isNull(workItems.deletedAt)))
      .groupBy(workItems.projectId);
    const aggMap = new Map(aggRows.map((r) => [r.projectId, r]));

    // 3. Active (committed) iteration name per project — ONE query.
    const iterRows = await this.db
      .select({ projectId: iterations.projectId, name: iterations.name })
      .from(iterations)
      .where(and(eq(iterations.workspaceId, workspaceId), eq(iterations.state, 'committed')));
    const sprintMap = new Map<string, string>();
    for (const r of iterRows) if (!sprintMap.has(r.projectId)) sprintMap.set(r.projectId, r.name);

    // 4. Lead display names — ONE query.
    const leadIds = [
      ...new Set(projectRows.map((p) => p.leadId).filter((id): id is string => id != null)),
    ];
    const leadNameMap = new Map<string, string>();
    if (leadIds.length > 0) {
      const leadRows = await this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, leadIds));
      for (const u of leadRows) leadNameMap.set(u.id, u.displayName);
    }

    // Assemble, sort by attention (blocked, then open defects, then name), cap.
    const rows: ProjectHealth[] = projectRows.map((p) => {
      const a = aggMap.get(p.id);
      const total = a?.total ?? 0;
      const done = a?.done ?? 0;
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        leadId: p.leadId,
        leadName: p.leadId != null ? (leadNameMap.get(p.leadId) ?? null) : null,
        activeSprintName: sprintMap.get(p.id) ?? null,
        progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
        openDefects: a?.openDefects ?? 0,
        blockedCount: a?.blocked ?? 0,
      };
    });
    rows.sort(
      (x, y) =>
        y.blockedCount - x.blockedCount ||
        y.openDefects - x.openDefects ||
        x.name.localeCompare(y.name),
    );
    return rows.slice(0, limit);
  }

  async create(input: CreateProjectInput, tx?: DbExecutor): Promise<Project> {
    const rows = await (tx ?? this.db)
      .insert(projects)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        key: input.key,
        name: input.name,
        description: input.description,
        leadId: input.leadId,
        startDate: input.startDate ?? null,
      })
      .returning();
    return rows[0] as Project;
  }

  async update(
    id: string,
    input: UpdateProjectInput,
    workspaceId: string,
    tx?: DbExecutor,
  ): Promise<Project> {
    const rows = await (tx ?? this.db)
      .update(projects)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.leadId !== undefined && { leadId: input.leadId }),
        ...(input.startDate !== undefined && { startDate: input.startDate }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.settings !== undefined && { settings: input.settings }),
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
      .returning();
    return rows[0] as Project;
  }

  async softDelete(id: string, workspaceId: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)));
  }

  async initCounter(projectId: string, workspaceId: string, tx?: DbExecutor): Promise<void> {
    const db = tx ?? this.db;
    // Seed a counter row for every work-item type so any type can be created
    const types = ['initiative', 'feature', 'story', 'task', 'defect'] as const;
    for (const itemType of types) {
      await db
        .insert(projectCounters)
        .values({ projectId, workspaceId, itemType, lastItemNumber: 0 })
        .onConflictDoNothing();
    }
  }

  async incrementCounter(
    projectId: string,
    workspaceId: string,
    itemType: WorkItemType,
    tx?: DbExecutor,
  ): Promise<number> {
    const db = tx ?? this.db;
    const rows = await db
      .update(projectCounters)
      .set({
        lastItemNumber: sql`${projectCounters.lastItemNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectCounters.projectId, projectId),
          eq(projectCounters.workspaceId, workspaceId),
          eq(projectCounters.itemType, itemType),
        ),
      )
      .returning({ lastItemNumber: projectCounters.lastItemNumber });
    return rows[0].lastItemNumber;
  }

  async getMaxItemNumber(
    projectId: string,
    workspaceId: string,
    itemType: WorkItemType,
  ): Promise<number> {
    const row = await this.db
      .select({ max: sql<number>`COALESCE(MAX(${projectCounters.lastItemNumber}), 0)` })
      .from(projectCounters)
      .where(
        and(
          eq(projectCounters.projectId, projectId),
          eq(projectCounters.workspaceId, workspaceId),
          eq(projectCounters.itemType, itemType),
        ),
      );
    return row[0].max;
  }
}
