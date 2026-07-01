import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { teams } from '../../../../../../db/schema/work';
import type { Team, CreateTeamInput, UpdateTeamInput } from '../../domain/team.types';
import { ITeamRepository } from '../../domain/ports/team.repository';

@Injectable()
export class TeamDrizzleRepository implements ITeamRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Team | null> {
    const rows = await this.db.select().from(teams).where(eq(teams.id, id)).limit(1);
    return (rows[0] as Team | undefined) ?? null;
  }

  async findByKey(workspaceId: string, key: string): Promise<Team | null> {
    const rows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.workspaceId, workspaceId), eq(teams.key, key)))
      .limit(1);
    return (rows[0] as Team | undefined) ?? null;
  }

  async listByWorkspace(workspaceId: string): Promise<Team[]> {
    const rows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.workspaceId, workspaceId), eq(teams.status, 'active')))
      .orderBy(teams.name);
    return rows as Team[];
  }

  async create(input: CreateTeamInput): Promise<Team> {
    const rows = await this.db
      .insert(teams)
      .values({
        id: input.id,
        tenantId: input.tenantId,
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
    return rows[0] as Team;
  }

  async update(id: string, input: UpdateTeamInput): Promise<Team> {
    const rows = await this.db
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
    return rows[0] as Team;
  }
}
