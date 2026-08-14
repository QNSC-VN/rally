import type {
  ProjectMember,
  AddProjectMemberInput,
  UpdateProjectMemberInput,
} from '../project.types';
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
  addMember(input: AddProjectMemberInput, tx?: DbExecutor): Promise<ProjectMember>;
  updateMember(
    id: string,
    input: UpdateProjectMemberInput,
    tx?: DbExecutor,
  ): Promise<ProjectMember>;
  removeMember(projectId: string, userId: string, actorId: string, tx?: DbExecutor): Promise<void>;
}
