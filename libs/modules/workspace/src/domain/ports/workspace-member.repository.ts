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
  /**
   * The user's own email address, for binding an invitation to its recipient.
   *
   * On this repository rather than a new identity port because it already joins `identity.users`
   * for the member roster; a second port for one column would be ceremony.
   */
  findUserEmail(userId: string): Promise<string | null>;
  /**
   * Grant the invited workspace-scoped role, in the caller's transaction.
   *
   * `workspace_members.role_id` is denormalised and NOT authoritative — this repository's own
   * members query reads the role from `user_role_assignments`, and so does every permission check.
   * `onConflictDoNothing` because a user may already hold the role (a re-invite, or an admin who
   * granted it by hand while the invitation was pending): the accept must not fail for that.
   */
  grantWorkspaceRole(
    input: { workspaceId: string; userId: string; roleId: string; grantedBy: string },
    tx?: DbExecutor,
  ): Promise<void>;
}
