import type { CursorPayload, PagedResult } from '@platform';
import type {
  Iteration,
  IterationOption,
  IterationReference,
  CreateIterationInput,
  UpdateIterationInput,
  IterationFilters,
} from '../iteration.types';

export const ITERATION_REPOSITORY = Symbol('ITERATION_REPOSITORY');

export interface IIterationRepository {
  findById(id: string): Promise<Iteration | null>;
  listByProject(
    projectId: string,
    workspaceId: string,
    filters: IterationFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Iteration>>;
  /** Sum of child task estimate_hours per iteration (IT-001 rollup). */
  taskEstimatesByIteration(
    workspaceId: string,
    iterationIds: string[],
  ): Promise<Map<string, number>>;
  /**
   * ELIGIBILITY. Compact list for the assignment picker: only `planning` and
   * `committed` iterations; never paginated.
   */
  listAssignmentOptions(
    projectId: string,
    workspaceId: string,
    teamId?: string,
  ): Promise<IterationOption[]>;
  /**
   * REFERENCE. Every state, so an ACCEPTED iteration still resolves to a name — which is the one
   * thing {@link listAssignmentOptions} structurally cannot do, and the reason six SPA call sites
   * read the timebox RECORD instead. Never paginated, same as the eligibility feed.
   */
  listReferences(
    projectId: string,
    workspaceId: string,
    teamId?: string,
  ): Promise<IterationReference[]>;
  /** Next per-project iteration number (drives the IT-<n> display key). */
  nextKeyNumber(projectId: string, workspaceId: string): Promise<number>;
  create(input: CreateIterationInput): Promise<Iteration>;
  update(id: string, input: UpdateIterationInput): Promise<Iteration>;
  delete(id: string): Promise<void>;
}
