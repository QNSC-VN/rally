import type { RawTeamStatusTaskRow } from '../team-status.types';

export const TEAM_STATUS_REPOSITORY = Symbol('TEAM_STATUS_REPOSITORY');

export interface ITeamStatusRepository {
  /** Fetch task-level rows for an iteration, with parent work product and release joins. */
  getTaskRows(
    iterationId: string,
    workspaceId: string,
    teamId?: string | null,
  ): Promise<RawTeamStatusTaskRow[]>;

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
