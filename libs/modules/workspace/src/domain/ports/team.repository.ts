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

  /**
   * What would be DESTROYED or ORPHANED by deleting this team, per source, non-zero rows only.
   *
   * A team is deletable only when this is empty, and the guard exists because the schema cannot
   * enforce it: `work_items.team_id`, `tasks.team_id`, `iterations.team_id` and
   * `portfolio_items.team_id` carry NO foreign key to `teams`, so a delete leaves them pointing at a
   * row that is gone — silently, since every reader resolves the name by join and simply renders
   * nothing. The tables that DO have one are worse in the other direction: `member_capacity`,
   * `iteration_daily_snapshots`, `iteration_team_baselines` and `release_team_targets` are
   * `ON DELETE CASCADE`, so the database would happily destroy frozen report history, which is the
   * one thing "Archive Team does not delete the linked Work Item/Sprint history" (DB design §488)
   * exists to prevent.
   *
   * Membership (`team_members`) and project links (`project_teams`) are deliberately NOT counted here:
   * they describe the team itself rather than delivery history, they have no foreign key either, and
   * {@link deleteTeam} removes them in the same transaction.
   */
  countHistoryReferences(
    teamId: string,
    workspaceId: string,
  ): Promise<Array<{ source: string; count: number }>>;

  /**
   * Hard-delete a team AND the rows that describe it — its roster and its project links.
   *
   * Both are cleaned explicitly because neither has a foreign key to `teams`, so nothing would remove
   * them and a future team reusing the id is not the only problem: `listByTeam` would keep returning
   * members of a team that no longer exists. Only ever called once
   * {@link countHistoryReferences} is empty.
   */
  deleteTeam(teamId: string, workspaceId: string, tx?: DbExecutor): Promise<void>;

  // ── project links (project_teams, team side) ──────────────────────────────
  /** Active project ids this team is linked to. */
  listActiveProjectIds(teamId: string): Promise<string[]>;
  /**
   * Capacity plans that reference this team on any of the given (about-to-be-unlinked)
   * projects — the team-side mirror of the project-side unlink guard. Non-empty means
   * the unlink must be REFUSED, not silently orphan committed planning demand.
   */
  findBlockingCapacityPlans(
    workspaceId: string,
    teamId: string,
    projectIds: string[],
  ): Promise<Array<{ planKey: string }>>;
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
