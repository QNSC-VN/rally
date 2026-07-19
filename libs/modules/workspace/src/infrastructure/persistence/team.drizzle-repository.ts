import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { teams, teamMembers } from '../../../../../../db/schema/work';
import type {
  Team,
  TeamWithStats,
  CreateTeamInput,
  UpdateTeamInput,
} from '../../domain/team.types';
import { ITeamRepository } from '../../domain/ports/team.repository';

@Injectable()
export class TeamDrizzleRepository implements ITeamRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  // Every read carries an explicit workspace_id predicate. This is defence in
  // depth that holds even when the query runs outside an RLS workspace context
  // (e.g. a superuser connection in dev, where RLS is bypassed) — workspace
  // isolation never depends on RLS + connection role alone.
  async findById(id: string, workspaceId: string): Promise<Team | null> {
    const rows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByKey(workspaceId: string, key: string): Promise<Team | null> {
    const rows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.workspaceId, workspaceId), eq(teams.key, key)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByWorkspaceWithStats(workspaceId: string): Promise<TeamWithStats[]> {
    const rows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.workspaceId, workspaceId), eq(teams.status, 'active')))
      .orderBy(teams.name);

    if (rows.length === 0) {
      return [];
    }

    // Count active members per team (no N+1: single grouped query).
    const teamIds = rows.map((t) => t.id);
    const countRows = await this.db
      .select({
        teamId: teamMembers.teamId,
        count: sql<number>`SUM(CASE WHEN ${teamMembers.status} = 'active' THEN 1 ELSE 0 END)::int`,
      })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, teamIds))
      .groupBy(teamMembers.teamId);

    const countMap: Record<string, number> = {};
    for (const row of countRows) {
      countMap[row.teamId] = row.count;
    }

    return rows.map((t) => ({ ...t, memberCount: countMap[t.id] ?? 0 }));
  }

  async create(input: CreateTeamInput, tx?: DbExecutor): Promise<Team> {
    const rows = await (tx ?? this.db)
      .insert(teams)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        name: input.name,
        key: input.key.toUpperCase(),
        description: input.description ?? null,
        leadId: input.leadId ?? null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return rows[0];
  }

  async update(id: string, input: UpdateTeamInput, tx?: DbExecutor): Promise<Team> {
    const rows = await (tx ?? this.db)
      .update(teams)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.leadId !== undefined && { leadId: input.leadId }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, id))
      .returning();
    return rows[0];
  }
}
