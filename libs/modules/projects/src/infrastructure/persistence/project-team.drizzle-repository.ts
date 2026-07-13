import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { projectTeams, teams } from '../../../../../../db/schema/work';
import type { ProjectTeamLink } from '../../domain/project.types';
import { IProjectTeamRepository } from '../../domain/ports/project-team.repository';

@Injectable()
export class ProjectTeamDrizzleRepository implements IProjectTeamRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findLink(projectId: string, teamId: string): Promise<ProjectTeamLink | null> {
    const rows = await this.db
      .select()
      .from(projectTeams)
      .where(
        and(
          eq(projectTeams.projectId, projectId),
          eq(projectTeams.teamId, teamId),
          eq(projectTeams.status, 'active'),
        ),
      )
      .limit(1);
    return (rows[0]) ?? null;
  }

  async listByProject(projectId: string): Promise<ProjectTeamLink[]> {
    const rows = await this.db
      .select({
        id: projectTeams.id,
        workspaceId: projectTeams.workspaceId,
        projectId: projectTeams.projectId,
        teamId: projectTeams.teamId,
        status: projectTeams.status,
        linkedAt: projectTeams.linkedAt,
        unlinkedAt: projectTeams.unlinkedAt,
        name: teams.name,
        key: teams.key,
      })
      .from(projectTeams)
      .leftJoin(teams, eq(projectTeams.teamId, teams.id))
      .where(and(eq(projectTeams.projectId, projectId), eq(projectTeams.status, 'active')))
      .orderBy(projectTeams.linkedAt);
    return rows.map((r) => ({
      ...r,
      name: r.name ?? undefined,
      key: r.key ?? undefined,
    }));
  }

  async linkTeam(
    id: string,
    workspaceId: string,
    projectId: string,
    teamId: string,
  ): Promise<ProjectTeamLink> {
    const rows = await this.db
      .insert(projectTeams)
      .values({
        id,
        workspaceId,
        projectId,
        teamId,
        status: 'active',
        linkedAt: new Date(),
        unlinkedAt: null,
      })
      .returning();
    return rows[0];
  }

  async unlinkTeam(projectId: string, teamId: string): Promise<void> {
    await this.db
      .update(projectTeams)
      .set({ status: 'unlinked', unlinkedAt: new Date() })
      .where(
        and(
          eq(projectTeams.projectId, projectId),
          eq(projectTeams.teamId, teamId),
          eq(projectTeams.status, 'active'),
        ),
      );
  }
}
