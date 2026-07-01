import type { TeamMember } from '../team.types';

export const TEAM_MEMBER_REPOSITORY = Symbol('TEAM_MEMBER_REPOSITORY');

export interface ITeamMemberRepository {
  findMember(teamId: string, userId: string): Promise<TeamMember | null>;
  listByTeam(teamId: string): Promise<TeamMember[]>;
  addMember(id: string, tenantId: string, teamId: string, userId: string): Promise<TeamMember>;
  removeMember(teamId: string, userId: string): Promise<void>;
}
