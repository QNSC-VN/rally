import type { Team, TeamWithStats, CreateTeamInput, UpdateTeamInput } from '../team.types';
import type { DbExecutor } from '@platform';

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');

export interface ITeamRepository {
  findById(id: string, workspaceId: string): Promise<Team | null>;
  findByKey(workspaceId: string, key: string): Promise<Team | null>;
  /**
   * @param includeInactive when true, deactive (archived) teams are returned too
   *   (management tab needs all for metrics/filter); default active-only keeps
   *   deactive teams out of every create-flow selector.
   */
  listByWorkspaceWithStats(
    workspaceId: string,
    includeInactive?: boolean,
  ): Promise<TeamWithStats[]>;
  create(input: CreateTeamInput, tx?: DbExecutor): Promise<Team>;
  update(id: string, input: UpdateTeamInput, tx?: DbExecutor): Promise<Team>;

  // ── project links (project_teams, team side) ──────────────────────────────
  /** Active project ids this team is linked to. */
  listActiveProjectIds(teamId: string): Promise<string[]>;
  /** How many of the given project ids exist in the workspace (existence check). */
  countProjectsInWorkspace(workspaceId: string, projectIds: string[]): Promise<number>;
  /** Reconcile the team's active project links to exactly `projectIds`. */
  setProjectLinks(
    workspaceId: string,
    teamId: string,
    projectIds: string[],
    tx: DbExecutor,
  ): Promise<void>;
}
