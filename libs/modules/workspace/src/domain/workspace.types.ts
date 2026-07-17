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
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  roleId: string | null;
  status: InvitationStatus;
  invitedBy: string;
  expiresAt: Date;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
