import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  WorkspaceMember,
  WorkspaceMemberWithProfile,
  WorkspaceMembership,
  AddMemberInput,
  UpdateMemberInput,
} from '../workspace.types';

export const WORKSPACE_MEMBER_REPOSITORY = Symbol('WORKSPACE_MEMBER_REPOSITORY');

export interface IWorkspaceMemberRepository {
  findMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  findMemberById(id: string): Promise<WorkspaceMember | null>;
  /** Active workspace memberships for a user, most-recently-active first (login switcher). */
  findMembershipsForUser(userId: string): Promise<WorkspaceMembership[]>;
  listMembers(
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkspaceMember>>;
  listMembersWithProfile(workspaceId: string): Promise<WorkspaceMemberWithProfile[]>;
  addMember(input: AddMemberInput, tx?: DbExecutor): Promise<WorkspaceMember>;
  updateMember(id: string, input: UpdateMemberInput, tx?: DbExecutor): Promise<WorkspaceMember>;
  removeMember(workspaceId: string, userId: string, tx?: DbExecutor): Promise<void>;
  isMember(workspaceId: string, userId: string): Promise<boolean>;
  /** Stamp last_active_at so next login auto-selects the most recent workspace. */
  touchLastActive(userId: string, workspaceId: string): Promise<void>;
  countActiveAdmins(workspaceId: string): Promise<number>;
  /** True if the user holds the workspace-scoped admin role and is an active member. */
  isActiveAdmin(workspaceId: string, userId: string): Promise<boolean>;
}
