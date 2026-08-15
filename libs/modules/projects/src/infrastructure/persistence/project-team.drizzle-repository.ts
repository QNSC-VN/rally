import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { projectTeams, teams, teamMembers } from '../../../../../../db/schema/work';
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
    return rows[0] ?? null;
  }

  /**
   * The project's LIVE teams — the link active AND the team itself active.
   *
   * Both halves, because `project_teams` is a soft status flip and `teams.status` is a second one:
   * archiving a team leaves its link untouched, so a link-only predicate reported a disbanded team as
   * one of the project's teams. Everything downstream of this method is a picker or an assignment
   * check, and `CapacityPlansService.assertTeamInProject` already required both — so the Add Team
   * dialog on a capacity plan OFFERED an archived team and `POST /capacity-plans/:id/teams` then
   * answered `CAPACITY_TEAM_NOT_FOUND` for the row the reader had just been shown (P5-CP-006). A feed
   * must not offer what its write refuses.
   *
   * Narrowed HERE rather than behind a parameter, because no caller wants the wider set: this feeds
   * `GET /projects/:id/teams` (every team picker and filter in the SPA),
   * `assertTeamLinkedToProject` (the team a work item or iteration is being MOVED to — checked only
   * when that field is in the patch, so an item already sitting on an archived team still saves), and
   * `projectTeamContext`, whose own docblock requires it to count exactly the set the picker offers.
   * An archived team keeping its history is a REPORTING rule (Team Capacity still reports its hours,
   * flagged `archived`); it was never a rule about what may be newly assigned.
   *
   * `innerJoin`, not the `leftJoin` this had: once `teams.status` is in the predicate a NULL team can
   * no longer satisfy it, so a left join would describe a result set this cannot return. There is no
   * FK on `project_teams.team_id` (checked: none of the migrations add one), so an orphan link is
   * possible from raw SQL — it now drops out, which is the honest answer for a link naming a team that
   * does not exist and could not be rendered or assigned anyway.
   */
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
        leadId: teams.leadId,
        // Active-member count per team — the Teams tab's Members column and the
        // tree/detail surfaces render it; without it every count read 0.
        memberCount: sql<number>`(
          select count(*)::int from ${teamMembers}
          where ${teamMembers.teamId} = ${projectTeams.teamId}
            and ${teamMembers.status} = 'active'
        )`,
      })
      .from(projectTeams)
      .innerJoin(teams, eq(projectTeams.teamId, teams.id))
      .where(
        and(
          eq(projectTeams.projectId, projectId),
          eq(projectTeams.status, 'active'),
          eq(teams.status, 'active'),
        ),
      )
      .orderBy(projectTeams.linkedAt, asc(projectTeams.id));
    return rows;
  }

  async linkTeam(
    id: string,
    workspaceId: string,
    projectId: string,
    teamId: string,
    tx?: DbExecutor,
  ): Promise<ProjectTeamLink> {
    const rows = await (tx ?? this.db)
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
