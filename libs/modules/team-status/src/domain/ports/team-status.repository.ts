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
  getCapacities(iterationId: string, userIds: string[]): Promise<Map<string, number>>;

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
