import type { ProjectTeamLink } from '../project.types';
import type { DbExecutor } from '@platform';

export const PROJECT_TEAM_REPOSITORY = Symbol('PROJECT_TEAM_REPOSITORY');

export interface IProjectTeamRepository {
  findLink(projectId: string, teamId: string): Promise<ProjectTeamLink | null>;
  listByProject(projectId: string): Promise<ProjectTeamLink[]>;
  linkTeam(
    id: string,
    workspaceId: string,
    projectId: string,
    teamId: string,
    tx?: DbExecutor,
  ): Promise<ProjectTeamLink>;
  unlinkTeam(projectId: string, teamId: string): Promise<void>;
}
