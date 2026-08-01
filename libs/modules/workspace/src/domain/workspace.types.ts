import type { PreliminaryEstimateMap } from '../../../../../db/schema/enums';
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
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceSettings {
  id: string;
  workspaceId: string;
  timezone: string | null;
  defaultLocale: string | null;
  dateFormat: string | null;
  /**
   * T-shirt size → points/count, the denominator behind both Estimated Progress meters and
   * the Preliminary tier of a capacity plan.
   *
   * A SETTING, never a constant. The BA spec calls the seeded values "temporary mockup data"
   * and defers the real scale to Settings; Rally makes the equivalent mapping a
   * workspace-admin field ("add, modify, or delete preliminary estimate sizes and their
   * associated numeric values"). The column existed and was read from day one, but nothing
   * could write it — so it was configurable in the schema and hard-coded in practice.
   *
   * PARTIAL on purpose: the row stores only the sizes an operator has overridden, and
   * `PreliminaryEstimateMapService` merges them over the seeded default. Storing a complete
   * map would freeze a copy of today's defaults into every workspace, so a later change to
   * the seed would silently not apply to anyone.
   */
  preliminaryEstimateMap: Partial<PreliminaryEstimateMap>;
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
  /**
   * A PARTIAL map — only the sizes the caller sent are changed.
   *
   * Merged rather than replaced, so an operator retuning `M` cannot blank `XS` by omitting it.
   * The reader already merges over the seeded default for the same reason.
   */
  preliminaryEstimateMap?: Partial<PreliminaryEstimateMap>;
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
