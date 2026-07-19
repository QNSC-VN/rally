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

export interface TeamWithStats extends Team {
  memberCount: number;
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
