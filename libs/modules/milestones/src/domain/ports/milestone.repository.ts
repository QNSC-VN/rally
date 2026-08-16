import type { CursorPayload, PagedResult } from '@platform';
import type {
  Milestone,
  MilestoneOption,
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from '../milestone.types';

export const MILESTONE_REPOSITORY = Symbol('MILESTONE_REPOSITORY');

/**
 * One row of `milestone_artifacts`, which has been POLYMORPHIC since migration 0084.
 *
 * The entity type is carried explicitly rather than inferred by the repository, because only the
 * service knows which table an id resolved from — and `Phase 3/03_Milestones/SRS.md:116` makes all
 * four of Story, Defect, Feature and Epic directly assignable, so a writer that assumed one table
 * could not serve the §5.2 replace-set.
 */
export interface MilestoneArtifactLink {
  entityType: 'work_item' | 'portfolio_item';
  entityId: string;
}

export interface IMilestoneRepository {
  findById(id: string): Promise<Milestone | null>;
  listByProject(
    projectId: string,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Milestone>>;
  /**
   * The REFERENCE feed behind `GET /milestones/options`: every milestone in the project, projected to
   * what a picker needs. A separate query rather than a projection of {@link listByProject}, so the
   * record's columns are never read for a participant's request — and so no page cursor can truncate
   * an option list.
   */
  listOptionsByProject(projectId: string, workspaceId: string): Promise<MilestoneOption[]>;
  create(input: CreateMilestoneInput): Promise<Milestone>;
  update(id: string, input: UpdateMilestoneInput): Promise<Milestone>;
  delete(id: string): Promise<void>;
  /** Next per-project display-key number (MAX existing suffix + 1) for `MS-<n>`. */
  nextKeyNumber(projectId: string, workspaceId: string): Promise<number>;
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
  /**
   * Every DIRECTLY assigned artifact id, work items and portfolio items alike.
   *
   * Both types, because §5.2's payload replaces the whole directly assigned list and the picker that
   * builds it offers all four types (SRS:116). It used to filter `entity_type = 'work_item'`, which
   * meant a Feature assigned from the Feature detail rail was invisible to the picker's baseline and
   * so could be neither seen nor unticked from the Milestone end.
   */
  getArtifactIds(milestoneId: string): Promise<string[]>;
  /** Replaces the DIRECT artifact set wholesale — both entity types, in one transaction. */
  setArtifactLinks(milestoneId: string, artifacts: MilestoneArtifactLink[]): Promise<void>;
}
