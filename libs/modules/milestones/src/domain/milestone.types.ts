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

/**
 * The reference projection of a milestone: what a picker needs to label, choose and scope one.
 *
 * `releaseIds` is here because the Work Item detail sidebar narrows the ADD options to milestones
 * related to the item's selected release (Reconciliation C01) — that is a picker rule, not
 * administration data. `status`, `ownerId`, `description`, `notes`, the target window and `progress`
 * are the milestone RECORD and stay on {@link Milestone}.
 *
 * A type of its own, not `Pick<Milestone, …>`: a shared base is how a field added to the record joins
 * the feed every delivery participant reads.
 */
export interface MilestoneOption {
  id: string;
  projectId: string;
  milestoneKey: string | null;
  name: string;
  releaseIds: string[];
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
