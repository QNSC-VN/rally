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
  addMember(input: AddProjectMemberInput, tx?: DbExecutor): Promise<ProjectMember>;
  updateMember(id: string, input: UpdateProjectMemberInput): Promise<ProjectMember>;
  removeMember(projectId: string, userId: string): Promise<void>;
}
