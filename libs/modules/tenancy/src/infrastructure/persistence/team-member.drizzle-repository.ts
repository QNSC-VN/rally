import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { teamMembers } from '../../../../../../db/schema/work';
import type { TeamMember } from '../../domain/team.types';
import { ITeamMemberRepository } from '../../domain/ports/team-member.repository';

@Injectable()
export class TeamMemberDrizzleRepository implements ITeamMemberRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findMember(teamId: string, userId: string): Promise<TeamMember | null> {
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, 'active'),
        ),
      )
      .limit(1);
    return (rows[0] as TeamMember | undefined) ?? null;
  }

  async listByTeam(teamId: string): Promise<TeamMember[]> {
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, 'active')))
      .orderBy(teamMembers.joinedAt);
    return rows as TeamMember[];
  }

  async addMember(
    id: string,
    tenantId: string,
    teamId: string,
    userId: string,
  ): Promise<TeamMember> {
    const rows = await this.db
      .insert(teamMembers)
      .values({
        id,
        tenantId,
        teamId,
        userId,
        status: 'active',
        joinedAt: new Date(),
      })
      .returning();
    return rows[0] as TeamMember;
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await this.db
      .update(teamMembers)
      .set({ status: 'removed' })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  }
}
