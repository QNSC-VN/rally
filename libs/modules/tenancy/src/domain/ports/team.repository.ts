import type { Team, CreateTeamInput, UpdateTeamInput } from '../team.types';

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');

export interface ITeamRepository {
  findById(id: string, tenantId: string): Promise<Team | null>;
  findByKey(workspaceId: string, key: string, tenantId: string): Promise<Team | null>;
  listByWorkspace(workspaceId: string, tenantId: string): Promise<Team[]>;
  create(input: CreateTeamInput): Promise<Team>;
  update(id: string, input: UpdateTeamInput): Promise<Team>;
}
