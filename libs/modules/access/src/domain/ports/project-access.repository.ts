import type { DbExecutor } from '@platform';
import type { ProjectAccessLevel } from '@shared-kernel';
import type { ProjectAccessGrant } from '../project-access';

export const PROJECT_ACCESS_REPOSITORY = Symbol('PROJECT_ACCESS_REPOSITORY');

/**
 * The reads and writes behind {@link AccessService.grantProjectAccess} — the ONE writer of a
 * per-Project grant.
 *
 * EVERY method takes an optional executor, and that is the point of the port existing at all.
 * The writer has to be joinable to a transaction its caller already opened
 * (`WorkspaceService.acceptInvitation` and `TeamService.createTeam` both grant access beside
 * writes that must commit or roll back with it), and `UnitOfWork.run` is `db.transaction`, which
 * does not nest. A check that reads `this.db` while the caller holds an uncommitted
 * `workspace_members` row would not see it and would refuse the grant with
 * `ASSIGNEE_NOT_WORKSPACE_MEMBER` — so the executor is threaded through the CHECKS, not just the
 * writes. Skipping the check instead would let a user from another workspace/tenant be granted
 * access to a project.
 */
export interface IProjectAccessRepository {
  /** The project, if it exists in this workspace and is not soft-deleted. */
  findLiveProject(
    workspaceId: string,
    projectId: string,
    exec?: DbExecutor,
  ): Promise<{ id: string } | null>;

  /** Whether the user is an ACTIVE member of the owning workspace (PRJ-FR-006 / P1-15). */
  isActiveWorkspaceMember(workspaceId: string, userId: string, exec?: DbExecutor): Promise<boolean>;

  /**
   * The workspace's Workspace Admins — §2.1 keeps them out of every project roster and out of
   * every write that would create one. See `selectWorkspaceAdminUserIds`, the one home of the
   * predicate.
   */
  listWorkspaceAdminUserIds(workspaceId: string, exec?: DbExecutor): Promise<string[]>;

  /** The user's active grant on this project, or null. */
  findGrant(
    projectId: string,
    userId: string,
    exec?: DbExecutor,
  ): Promise<ProjectAccessGrant | null>;

  /**
   * Create (or reactivate) the grant row. `accessLevel` left undefined lands NULL — an honest
   * "member, no level yet" — never a defaulted level.
   */
  createGrant(
    input: {
      id: string;
      workspaceId: string;
      projectId: string;
      userId: string;
      accessLevel?: ProjectAccessLevel;
    },
    exec?: DbExecutor,
  ): Promise<ProjectAccessGrant>;

  /** Set the level on an existing grant row, leaving `joined_at` alone. */
  setGrantLevel(
    id: string,
    accessLevel: ProjectAccessLevel,
    exec?: DbExecutor,
  ): Promise<ProjectAccessGrant>;
}
