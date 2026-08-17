import type { ProjectAccessLevel } from '@shared-kernel';
import type {
  WorkspaceStatus,
  WorkspaceMemberStatus,
  InvitationStatus,
  TeamStatus,
  TeamMemberStatus,
} from '../../../../../db/schema/enums';
export type {
  WorkspaceStatus,
  WorkspaceMemberStatus,
  InvitationStatus,
  TeamStatus,
  TeamMemberStatus,
};

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  status: WorkspaceStatus;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  roleId: string | null;
  status: WorkspaceMemberStatus;
  lastActiveAt: Date | null;
  joinedAt: Date;
  updatedAt: Date;
  createdAt: Date;
}

/** Enriched member — includes user profile and current role for the User Management UI. */
export interface MemberTeamSummary {
  id: string;
  key: string;
  name: string;
}

export interface WorkspaceMemberWithProfile {
  id: string;
  workspaceId: string;
  userId: string;
  status: string;
  joinedAt: Date;
  createdAt: Date;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  phone: string | null;
  lastLoginAt: Date | null;
  roleAssignmentId: string | null;
  roleId: string | null;
  roleSlug: string | null;
  roleName: string | null;
  /** Active team memberships (SRS §6.2 Teams column; project access derives from these). */
  teams: MemberTeamSummary[];
}

/**
 * The ASSIGNEE / OWNER PICKER feed — the minimal half of the roster split.
 *
 * Deliberately NOT a subset type of {@link WorkspaceMemberWithProfile}: the whole point of the
 * split (RBE-07) is that these four fields travel to every delivery participant while `phone`,
 * `lastLoginAt` and the role ids travel only to the User Management surface. A structural subset
 * would let a later field land on both by accident, which is exactly how the sensitive fields came
 * to be on an ungated route in the first place.
 *
 * Name and email are here because they are already visible wherever a person appears — as an
 * assignee, a project lead, a task owner or a team member — so hiding them from a picker while
 * printing them in a grid would protect nothing.
 */
export interface WorkspaceMemberOption {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  /**
   * Whether a picker may OFFER this person as a new owner — the DECISION, not the account state it
   * is derived from.
   *
   * It used to be `status: 'active' | 'suspended' | 'removed'`, verbatim off `workspace_members`, and
   * that was a person's account state on the widest-audience feed in the product: no permission code,
   * read by every delivery participant, and no client ever looked at it. The requirement behind it is
   * real and is kept — an inactive member who still OWNS something must resolve to a name, or the
   * grid claims the item is unowned — so the row stays and only the disclosure goes. A boolean cannot
   * say WHY someone is unassignable, which is the point: whether a colleague is suspended or removed
   * is User Management's business (`GET :id/members-with-profile`, `workspace:view`).
   */
  assignable: boolean;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  roleId: string | null;
  status: InvitationStatus;
  invitedBy: string;
  expiresAt: Date;
  resendCount: number;
  lastSentAt: Date;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  /**
   * The invitee's Entra guest object id in OUR tenant, written by the guest-invite relay from Graph's
   * `invitedUser.id`. NULL for an invitee who is already a directory member (a member needs no guest
   * object), and for any invitation created before the column existed or while
   * `ENTRA_GUEST_INVITE_ENABLED` was off.
   *
   * Read by `acceptInvitation` as the STRONGER of its two recipient bindings: unlike the `email`
   * claim, a guest cannot edit it. See the binding block there for why the email fallback remains.
   */
  entraGuestObjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One project + level an invitation carries as INITIAL access (§6.4, migration 0119).
 *
 * `accessLevel` is typed as the shared catalogue union, not `string`: the CHECK constraint and
 * `isProjectAccessLevel` are the same two values, and a widened type here is how a level the
 * model does not have reaches a write (`viewer` was a CHECK value for a week; migrations 0113 and
 * 0115).
 */
export interface InvitationProjectAccess {
  projectId: string;
  accessLevel: ProjectAccessLevel;
}

export interface WorkspaceSettings {
  id: string;
  workspaceId: string;
  timezone: string | null;
  defaultLocale: string | null;
  dateFormat: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  id: string;
  slug: string;
  name: string;
  description?: string;
  avatarUrl?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  avatarUrl?: string | null;
  settings?: Record<string, unknown>;
}

export interface AddMemberInput {
  id: string;
  workspaceId: string;
  userId: string;
  roleId?: string;
}

export interface UpdateMemberInput {
  roleId?: string;
  status?: WorkspaceMemberStatus;
  /** When supplied, replaces the user's full set of team memberships (reconciled). */
  teamIds?: string[];
}

export interface CreateInvitationInput {
  id: string;
  workspaceId: string;
  email: string;
  roleId?: string;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
}

export interface UpdateWorkspaceSettingsInput {
  timezone?: string;
  defaultLocale?: string;
  dateFormat?: string;
}

/**
 * A user's membership in a workspace, as returned at login time.
 * Ordered most-recently-active first; the first entry is the auto-selected workspace.
 */
export interface WorkspaceMembership {
  workspaceId: string;
  name: string;
  slug: string;
  /** ISO-8601 string, or null if the user has never explicitly logged into this workspace. */
  lastActiveAt: string | null;
  /** The user's primary role slug in this workspace, e.g. 'workspace_admin'. Null when no assignment exists. */
  roleSlug: string | null;
  /** Human-readable role name, e.g. 'Workspace Admin'. */
  roleName: string | null;
}
