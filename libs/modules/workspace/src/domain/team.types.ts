import type { TeamStatus, TeamMemberStatus } from '../../../../../db/schema/enums';
export type { TeamStatus, TeamMemberStatus };

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  leadId: string | null;
  status: TeamStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** A project this team is actively linked to (via project_teams). */
export interface TeamProjectLink {
  projectId: string;
  key: string;
  name: string;
}

export interface TeamWithStats extends Team {
  memberCount: number;
  /** Active project links, oldest-first — the first is treated as "primary" in the list column. */
  projects: TeamProjectLink[];
}

export interface TeamMember {
  id: string;
  workspaceId: string;
  teamId: string;
  userId: string;
  status: TeamMemberStatus;
  joinedAt: Date;
}

export interface CreateTeamInput {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description?: string;
  leadId?: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string | null;
  leadId?: string | null;
  status?: TeamStatus;
}

/** Relations that create/update can set atomically alongside the team row. */
export interface TeamRelationsInput {
  /** Full set of project ids the team should be linked to (reconciled). */
  projectIds?: string[];
  /** Full set of user ids that should be members (reconciled). */
  memberUserIds?: string[];
}
