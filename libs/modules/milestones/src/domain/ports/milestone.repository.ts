import type { CursorPayload, PagedResult } from '@platform';
import type { Milestone, CreateMilestoneInput, UpdateMilestoneInput } from '../milestone.types';

export const MILESTONE_REPOSITORY = Symbol('MILESTONE_REPOSITORY');

export interface IMilestoneRepository {
  findById(id: string): Promise<Milestone | null>;
  listByProject(
    projectId: string,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Milestone>>;
  create(input: CreateMilestoneInput): Promise<Milestone>;
  update(id: string, input: UpdateMilestoneInput): Promise<Milestone>;
  delete(id: string): Promise<void>;
  /** Set linked releases for a milestone (replace all). */
  setReleaseLinks(milestoneId: string, releaseIds: string[]): Promise<void>;
  /** Get linked release IDs for a milestone. */
  getReleaseIds(milestoneId: string): Promise<string[]>;
  /** Derive target dates from linked releases. */
  deriveTargetDates(
    releaseIds: string[],
    workspaceId: string,
  ): Promise<{ startDate: string | null; endDate: string | null }>;
  // P3.3 — Multi-project/multi-team/artifact junction tables
  getProjectIds(milestoneId: string): Promise<string[]>;
  setProjectLinks(milestoneId: string, projectIds: string[]): Promise<void>;
  getTeamIds(milestoneId: string): Promise<string[]>;
  setTeamLinks(milestoneId: string, teamIds: string[]): Promise<void>;
  getArtifactIds(milestoneId: string): Promise<string[]>;
  setArtifactLinks(milestoneId: string, workItemIds: string[]): Promise<void>;
}
