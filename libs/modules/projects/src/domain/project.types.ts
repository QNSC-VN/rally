import type {
  WorkflowStatusCategory,
  ProjectStatus,
  ProjectTeamStatus,
  ProjectMemberStatus,
} from '../../../../../db/schema/enums';
export type { WorkflowStatusCategory, ProjectStatus, ProjectTeamStatus, ProjectMemberStatus };

export interface Project {
  id: string;
  tenantId: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  status: ProjectStatus;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface WorkflowStatus {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  category: WorkflowStatusCategory;
  color: string | null;
  position: number;
  isDefault: boolean;
  createdAt: Date;
}

export interface WorkflowTransition {
  id: string;
  tenantId: string;
  projectId: string;
  fromStatusId: string | null;
  toStatusId: string;
  name: string | null;
  requiredRole: string | null;
  createdAt: Date;
}

export interface CreateProjectInput {
  id: string;
  tenantId: string;
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
  leadId?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  leadId?: string | null;
  status?: ProjectStatus;
  settings?: Record<string, unknown>;
}

/** Project enriched with aggregated stats for the list endpoint */
export interface ProjectWithStats extends Project {
  memberCount: number;
  teamCount: number;
  leadName: string | null;
}

export interface CreateWorkflowStatusInput {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  category: WorkflowStatusCategory;
  color?: string;
  position: number;
  isDefault?: boolean;
}

export interface CreateWorkflowTransitionInput {
  id: string;
  tenantId: string;
  projectId: string;
  fromStatusId?: string | null;
  toStatusId: string;
  name?: string;
}

export interface ProjectTeamLink {
  id: string;
  tenantId: string;
  projectId: string;
  teamId: string;
  status: ProjectTeamStatus;
  linkedAt: Date;
  unlinkedAt: Date | null;
}

export interface ProjectMember {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  roleId: string | null;
  status: ProjectMemberStatus;
  joinedAt: Date;
  updatedAt: Date;
}

export interface AddProjectMemberInput {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  roleId?: string;
}

export interface UpdateProjectMemberInput {
  roleId?: string;
  status?: ProjectMemberStatus;
}
