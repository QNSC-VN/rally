import type { ProjectMember, UpdateProjectMemberInput } from '../project.types';
import type { DbExecutor } from '@platform';

export const PROJECT_MEMBER_REPOSITORY = Symbol('PROJECT_MEMBER_REPOSITORY');

export interface IProjectMemberRepository {
  findMember(projectId: string, userId: string): Promise<ProjectMember | null>;
  findMemberById(id: string): Promise<ProjectMember | null>;
  listByProject(projectId: string): Promise<ProjectMember[]>;
  /**
   * The workspace's Workspace Admins. §2.1 keeps them out of every project roster and every
   * add-candidate list, so the service needs the set to enforce the rule on the write path
   * too — see `selectWorkspaceAdminUserIds`, which is the one place the predicate lives.
   */
  listWorkspaceAdminUserIds(workspaceId: string): Promise<string[]>;
  // There is deliberately no `addMember` here. CREATING a grant row is
  // `AccessService.grantProjectAccess` — the one writer all three §5 journeys reach (AC-9) — and
  // its SQL moved to `ProjectAccessDrizzleRepository.createGrant` with it. A second insert path
  // here is exactly how the reactivation rule for `uq_project_member` would come to exist in two
  // versions, one of which would be wrong.
  updateMember(
    id: string,
    input: UpdateProjectMemberInput,
    tx?: DbExecutor,
  ): Promise<ProjectMember>;
  removeMember(projectId: string, userId: string, actorId: string, tx?: DbExecutor): Promise<void>;
}
