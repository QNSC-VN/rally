import type {
  TenantStatus,
  SubscriptionPlan,
  WorkspaceMemberStatus,
  InvitationStatus,
  TeamStatus,
  TeamMemberStatus,
} from '../../../../../db/schema/enums';
export type {
  TenantStatus,
  SubscriptionPlan,
  WorkspaceMemberStatus,
  InvitationStatus,
  TeamStatus,
  TeamMemberStatus,
};

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: SubscriptionPlan;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Workspace {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface WorkspaceMember {
  id: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  roleId: string | null;
  status: WorkspaceMemberStatus;
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
  roleAssignmentId: string | null;
  roleId: string | null;
  roleSlug: string | null;
  roleName: string | null;
}

export interface WorkspaceInvitation {
  id: string;
  tenantId: string;
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
  tenantId: string;
  timezone: string | null;
  defaultLocale: string | null;
  dateFormat: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  id: string;
  tenantId: string;
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
  tenantId: string;
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
  tenantId: string;
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

export interface CreateTenantInput {
  id: string;
  slug: string;
  name: string;
}

export interface TenantDomain {
  id: string;
  tenantId: string;
  domain: string;
  verified: Date | null;
  allowAutoJoin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantDomainInput {
  id: string;
  tenantId: string;
  domain: string;
  verified?: Date | null;
  allowAutoJoin?: boolean;
}

/** Result of provisioning a brand-new tenant via self-serve signup. */
export interface ProvisionedTenant {
  tenant: Tenant;
  workspace: Workspace;
}

/** Target tenant/workspace a signup should join (existing claimed domain). */
export interface AutoJoinTarget {
  tenantId: string;
  workspaceId: string;
}

// ── Tenant membership (keycard) ───────────────────────────────────────────────

export interface TenantMember {
  id: string;
  tenantId: string;
  userId: string;
  roleId: string | null;
  status: 'active' | 'suspended' | 'removed';
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantMemberInput {
  id: string;
  tenantId: string;
  userId: string;
  roleId?: string;
}

/**
 * A user's membership in a tenant — the "keycard" — as returned at login time.
 * Ordered most-recently-active first; the first entry is the auto-selected tenant.
 */
export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  /** ISO-8601 string, or null if the user has never explicitly logged into this tenant. */
  lastActiveAt: string | null;
  /** The user's primary role slug in this tenant, e.g. 'workspace_admin'. Null when no assignment exists. */
  roleSlug: string | null;
  /** Human-readable role name, e.g. 'Workspace Admin'. */
  roleName: string | null;
}
