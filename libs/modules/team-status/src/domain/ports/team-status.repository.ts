import type { RawTeamStatusTaskRow, TeamStatusRosterMember } from '../team-status.types';

export const TEAM_STATUS_REPOSITORY = Symbol('TEAM_STATUS_REPOSITORY');

export interface ITeamStatusRepository {
  /** Fetch task-level rows for an iteration, with parent work product and release joins. */
  getTaskRows(
    iterationId: string,
    workspaceId: string,
    teamId?: string | null,
  ): Promise<RawTeamStatusTaskRow[]>;

  /**
   * List active roster members for the iteration's team, or the project's
   * members when no team is given (non-team-scoped iteration). Returns identity
   * only — capacities and task aggregates are layered on by the service.
   */
  getRosterMembers(input: {
    workspaceId: string;
    projectId: string;
    teamId?: string | null;
  }): Promise<TeamStatusRosterMember[]>;

  /** Get capacity for a set of (iterationId, userId) pairs. */
  /**
   * Persisted capacity per member for one iteration.
   *
   * `teamId` is required (nullable) because `member_capacity` is unique on
   * `(project_id, team_id, iteration_id, user_id)` — a member on two teams legitimately has TWO rows
   * in one iteration, so a read that ignores the team cannot say which one it returned.
   */
  getCapacities(
    iterationId: string,
    userIds: string[],
    teamId: string | null,
  ): Promise<Map<string, number>>;

  /** Upsert member capacity. */
  upsertCapacity(input: {
    workspaceId: string;
    projectId: string;
    teamId: string;
    iterationId: string;
    userId: string;
    capacityHours: number;
  }): Promise<{ userId: string; capacityHours: number }>;
}
