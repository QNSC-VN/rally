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
  /** Reconcile the team's active members to exactly `userIds`. */
  setMembers(workspaceId: string, teamId: string, userIds: string[], tx: DbExecutor): Promise<void>;
  /** Reconcile a single user's active team memberships to exactly `teamIds`. */
  setTeamsForUser(
    workspaceId: string,
    userId: string,
    teamIds: string[],
    tx: DbExecutor,
  ): Promise<void>;
}
