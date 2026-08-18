import type { RawTeamStatusTaskRow, TeamStatusRosterMember } from '../team-status.types';

export const TEAM_STATUS_REPOSITORY = Symbol('TEAM_STATUS_REPOSITORY');

/**
 * The caller's Team read scope, derived from the resolver rather than re-declared so the two cannot
 * drift (BA ruling 2026-08-17). `{ unrestricted: true }` is a Workspace Admin or per-project Admin;
 * an empty `teamIds` is a real answer — no rows — and must never be read as "no filter".
 */
import type { TeamReadScope } from '@modules/access';

export type { TeamReadScope };

export interface ITeamStatusRepository {
  /**
   * Fetch task-level rows for an iteration, with parent work product and release joins.
   *
   * `scope` is REQUIRED, so a new call site cannot silently widen the boundary — the mistake the
   * 2026-08-14 removal note in `AccessService` describes.
   */
  getTaskRows(
    iterationId: string,
    workspaceId: string,
    teamId: string | null | undefined,
    scope: TeamReadScope,
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
