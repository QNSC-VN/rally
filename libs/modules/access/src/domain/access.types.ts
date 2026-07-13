import type { ScopeType } from '../../../../../db/schema/enums';
export type { ScopeType };

export interface SystemRole {
  id: string;
  workspaceId: string | null; // null = global system role
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  createdAt: Date;
}

export interface UserRoleAssignment {
  id: string;
  workspaceId: string;
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  grantedBy: string | null;
  createdAt: Date;
}

export interface AssignRoleInput {
  id: string;
  workspaceId: string;
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId?: string;
  grantedBy: string;
}

/**
 * A user's role assignment joined with the role's permission set — the shape
 * returned by a single assignments ⨝ roles query. Lets permission resolution
 * (baseline & per-project) avoid an N+1 fan-out of per-role lookups.
 */
export interface EffectiveAssignment {
  scopeType: ScopeType;
  scopeId: string | null;
  roleSlug: string;
  permissions: string[];
}
