import type { DbExecutor } from '@platform';
import type {
  WorkspaceMember,
  WorkspaceMemberOption,
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
  /**
   * The ADMINISTRATIVE roster — profile, contact details, last login and role ids. Reached only
   * through `GET :id/members-with-profile`, which is `workspace:view` (Workspace Admin) gated.
   */
  listMembersWithProfile(workspaceId: string): Promise<WorkspaceMemberWithProfile[]>;
  /**
   * The PICKER roster — id, name, email, avatar. Reached through `GET :id/member-options`, which
   * every delivery participant may read. A separate QUERY, not a projection of the one above: the
   * sensitive columns must not be selected on a path that does not need them.
   */
  /**
   * The picker feed. `projectIds === null` is UNRESTRICTED (a workspace-wide grant) and returns every
   * member; a list NARROWS the population to people those projects actually reference — their active
   * members plus their leads. See `WorkspaceService.listMemberOptions` for why the lead has to be
   * unioned in separately.
   */
  listMemberOptions(
    workspaceId: string,
    projectIds: string[] | null,
  ): Promise<WorkspaceMemberOption[]>;
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
   * The user's Entra subject ids (`oid`), for binding an invitation to the DIRECTORY OBJECT rather
   * than to a claim the holder can edit.
   *
   * Returned as a list because `sso_identities` is unique on `(provider, provider_sub)`, not on
   * `(provider, user_id)` — a person legitimately has one row per subject they have linked.
   *
   * Same reasoning as `findUserEmail` for living here: this repository already joins `identity.*`,
   * and a second port for one column would be ceremony.
   */
  findSsoSubjects(userId: string, provider: 'entra'): Promise<string[]>;
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
