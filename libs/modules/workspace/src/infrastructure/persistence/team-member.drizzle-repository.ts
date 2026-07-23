import { Injectable } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
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
    return rows[0] ?? null;
  }

  async listByTeam(teamId: string): Promise<TeamMember[]> {
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, 'active')))
      .orderBy(teamMembers.joinedAt);
    return rows;
  }

  async addMember(
    id: string,
    workspaceId: string,
    teamId: string,
    userId: string,
    tx?: DbExecutor,
  ): Promise<TeamMember> {
    const rows = await (tx ?? this.db)
      .insert(teamMembers)
      .values({
        id,
        workspaceId,
        teamId,
        userId,
        status: 'active',
        joinedAt: new Date(),
      })
      .returning();
    return rows[0];
  }

  async removeMember(teamId: string, userId: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(teamMembers)
      .set({ status: 'removed' })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  }

  async setMembers(
    workspaceId: string,
    teamId: string,
    userIds: string[],
    tx: DbExecutor,
  ): Promise<void> {
    // Mark any active member not in the desired set as removed.
    await tx
      .update(teamMembers)
      .set({ status: 'removed' })
      .where(
        userIds.length > 0
          ? and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.status, 'active'),
              notInArray(teamMembers.userId, userIds),
            )
          : and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, 'active')),
      );

    // Upsert each desired member to active (reactivates a previously-removed row).
    for (const userId of userIds) {
      await tx
        .insert(teamMembers)
        .values({
          id: uuidv7(),
          workspaceId,
          teamId,
          userId,
          status: 'active',
          joinedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [teamMembers.teamId, teamMembers.userId],
          set: { status: 'active' },
        });
    }
  }

  async setTeamsForUser(
    workspaceId: string,
    userId: string,
    teamIds: string[],
    tx: DbExecutor,
  ): Promise<void> {
    // Remove the user from any active team not in the desired set.
    await tx
      .update(teamMembers)
      .set({ status: 'removed' })
      .where(
        teamIds.length > 0
          ? and(
              eq(teamMembers.userId, userId),
              eq(teamMembers.status, 'active'),
              notInArray(teamMembers.teamId, teamIds),
            )
          : and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'active')),
      );

    // Upsert the user into each desired team (reactivates a previously-removed row).
    for (const teamId of teamIds) {
      await tx
        .insert(teamMembers)
        .values({
          id: uuidv7(),
          workspaceId,
          teamId,
          userId,
          status: 'active',
          joinedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [teamMembers.teamId, teamMembers.userId],
          set: { status: 'active' },
        });
    }
  }
}
