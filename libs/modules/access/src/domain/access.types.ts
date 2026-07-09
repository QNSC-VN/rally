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
