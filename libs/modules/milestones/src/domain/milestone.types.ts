import type { MilestoneStatus } from '../../../../../db/schema/enums';
export type { MilestoneStatus };

export interface Milestone {
  id: string;
  workspaceId: string;
  projectId: string;
  milestoneKey: string | null;
  name: string;
  description: string | null;
  notes: string | null;
  status: MilestoneStatus;
  ownerId: string | null;
  targetStartDate: string | null; // YYYY-MM-DD (manual or derived from linked releases)
  targetEndDate: string | null; // YYYY-MM-DD (manual or derived from linked releases)
  releaseIds: string[];
  // P3.3 — Multi-project/multi-team support
  projectIds?: string[];
  teamIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMilestoneInput {
  id: string;
  workspaceId: string;
  projectId: string;
  milestoneKey?: string | null;
  name: string;
  description?: string;
  notes?: string;
  status?: MilestoneStatus;
  ownerId?: string;
  /** Manual target dates — persisted only while no Release is linked (SRS §2). */
  targetStartDate?: string | null;
  targetEndDate?: string | null;
  releaseIds?: string[];
  projectIds?: string[];
  teamIds?: string[];
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string | null;
  notes?: string | null;
  status?: MilestoneStatus;
  ownerId?: string | null;
  targetStartDate?: string | null;
  targetEndDate?: string | null;
  releaseIds?: string[];
  projectIds?: string[];
  teamIds?: string[];
}
