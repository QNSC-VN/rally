import type { TeamMember } from '../team.types';
import type { DbExecutor } from '@platform';

export const TEAM_MEMBER_REPOSITORY = Symbol('TEAM_MEMBER_REPOSITORY');

export interface ITeamMemberRepository {
  findMember(teamId: string, userId: string): Promise<TeamMember | null>;
  listByTeam(teamId: string): Promise<TeamMember[]>;
  addMember(
    id: string,
    workspaceId: string,
    teamId: string,
    userId: string,
    tx?: DbExecutor,
  ): Promise<TeamMember>;
  removeMember(teamId: string, userId: string, tx?: DbExecutor): Promise<void>;
}
