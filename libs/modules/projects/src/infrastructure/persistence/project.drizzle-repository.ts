import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import {
  projects,
  projectCounters,
  projectMembers,
  projectTeams,
} from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import type {
  Project,
  ProjectWithStats,
  CreateProjectInput,
  UpdateProjectInput,
} from '../../domain/project.types';
import { IProjectRepository } from '../../domain/ports/project.repository';

@Injectable()
export class ProjectDrizzleRepository implements IProjectRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return (rows[0] as Project | undefined) ?? null;
  }

  async findByKey(tenantId: string, key: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(
        and(eq(projects.tenantId, tenantId), eq(projects.key, key), isNull(projects.deletedAt)),
      )
      .limit(1);
    return (rows[0] as Project | undefined) ?? null;
  }

  async listByWorkspace(
    workspaceId: string,
    tenantId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Project>> {
    const conditions = [
      eq(projects.workspaceId, workspaceId),
      eq(projects.tenantId, tenantId),
      isNull(projects.deletedAt),
    ];

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
    tenantId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<ProjectWithStats>> {
    const conditions = [
      eq(projects.workspaceId, workspaceId),
      eq(projects.tenantId, tenantId),
      isNull(projects.deletedAt),
    ];

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

  async create(input: CreateProjectInput, tx?: DbExecutor): Promise<Project> {
    const rows = await (tx ?? this.db)
      .insert(projects)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        key: input.key,
        name: input.name,
        description: input.description,
        leadId: input.leadId,
      })
      .returning();
    return rows[0] as Project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const rows = await this.db
      .update(projects)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.leadId !== undefined && { leadId: input.leadId }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.settings !== undefined && { settings: input.settings }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
    return rows[0] as Project;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, id));
  }

  async initCounter(projectId: string, tenantId: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .insert(projectCounters)
      .values({ projectId, tenantId, lastItemNumber: 0 })
      .onConflictDoNothing();
  }

  async incrementCounter(projectId: string): Promise<number> {
    const rows = await this.db
      .update(projectCounters)
      .set({
        lastItemNumber: sql`${projectCounters.lastItemNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(projectCounters.projectId, projectId))
      .returning({ lastItemNumber: projectCounters.lastItemNumber });
    return rows[0]!.lastItemNumber;
  }
}
