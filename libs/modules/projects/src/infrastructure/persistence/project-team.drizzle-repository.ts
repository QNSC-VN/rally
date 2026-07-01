import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { projectTeams } from '../../../../../../db/schema/work';
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
    return (rows[0] as ProjectTeamLink | undefined) ?? null;
  }

  async listByProject(projectId: string): Promise<ProjectTeamLink[]> {
    const rows = await this.db
      .select()
      .from(projectTeams)
      .where(and(eq(projectTeams.projectId, projectId), eq(projectTeams.status, 'active')))
      .orderBy(projectTeams.linkedAt);
    return rows as ProjectTeamLink[];
  }

  async linkTeam(
    id: string,
    tenantId: string,
    projectId: string,
    teamId: string,
  ): Promise<ProjectTeamLink> {
    const rows = await this.db
      .insert(projectTeams)
      .values({
        id,
        tenantId,
        projectId,
        teamId,
        status: 'active',
        linkedAt: new Date(),
        unlinkedAt: null,
      })
      .returning();
    return rows[0] as ProjectTeamLink;
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
