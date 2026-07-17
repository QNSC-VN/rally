import type { Team, CreateTeamInput, UpdateTeamInput } from '../team.types';
import type { DbExecutor } from '@platform';

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');

export interface ITeamRepository {
  findById(id: string, workspaceId: string): Promise<Team | null>;
  findByKey(workspaceId: string, key: string): Promise<Team | null>;
  listByWorkspace(workspaceId: string): Promise<Team[]>;
  create(input: CreateTeamInput, tx?: DbExecutor): Promise<Team>;
  update(id: string, input: UpdateTeamInput, tx?: DbExecutor): Promise<Team>;
}
