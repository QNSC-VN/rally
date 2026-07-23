import type {
  WorkflowStatusCategory,
  ProjectStatus,
  ProjectTeamStatus,
  ProjectMemberStatus,
} from '../../../../../db/schema/enums';
export type { WorkflowStatusCategory, ProjectStatus, ProjectTeamStatus, ProjectMemberStatus };

export interface Project {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  startDate: string | null;
  status: ProjectStatus;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface WorkflowStatus {
  id: string;
  workspaceId: string;
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
  workspaceId: string;
  projectId: string;
  fromStatusId: string | null;
  toStatusId: string;
  name: string | null;
  requiredRole: string | null;
  createdAt: Date;
}

export interface CreateProjectInput {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
  leadId?: string;
  startDate?: string | null;
}

/**
 * Service-layer input for creating a project. Distinct from the persistence
 * {@link CreateProjectInput} (which carries the generated id/workspaceId): this
 * is what the HTTP layer passes in, including the optional team links to seed.
 */
export interface CreateProjectRequest {
  key: string;
  name: string;
  description?: string;
  leadId?: string;
  startDate?: string | null;
  teamIds?: string[];
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  leadId?: string | null;
  startDate?: string | null;
  status?: ProjectStatus;
  settings?: Record<string, unknown>;
}

/** Project enriched with aggregated stats for the list endpoint */
export interface ProjectWithStats extends Project {
  memberCount: number;
  teamCount: number;
  leadName: string | null;
}

/**
 * Per-project rollup for the Home "Project Health" widget. Computed server-side
 * in a bounded, batched query set (no per-project N+1) and returned already
 * sorted by "attention" (blocked, then open defects, then name).
 */
export interface ProjectHealth {
  id: string;
  key: string;
  name: string;
  leadId: string | null;
  leadName: string | null;
  activeSprintName: string | null;
  /** done / total * 100, rounded; 0 when the project has no items. */
  progressPercent: number;
  openDefects: number;
  blockedCount: number;
}

export interface CreateWorkflowStatusInput {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  category: WorkflowStatusCategory;
  color?: string;
  position: number;
  isDefault?: boolean;
}

export interface CreateWorkflowTransitionInput {
  id: string;
  workspaceId: string;
  projectId: string;
  fromStatusId?: string | null;
  toStatusId: string;
  name?: string;
}

export interface ProjectTeamLink {
  id: string;
  workspaceId: string;
  projectId: string;
  teamId: string;
  status: ProjectTeamStatus;
  linkedAt: Date;
  unlinkedAt: Date | null;
  name?: string;
  key?: string;
}

export interface ProjectMember {
  id: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  roleId: string | null;
  status: ProjectMemberStatus;
  joinedAt: Date;
  updatedAt: Date;
  /** Joined from users table */
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface AddProjectMemberInput {
  id: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  roleId?: string;
}

export interface UpdateProjectMemberInput {
  roleId?: string;
  status?: ProjectMemberStatus;
}
