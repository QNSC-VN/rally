import type { CursorPayload, PagedResult } from '@platform';
import type {
  Iteration,
  IterationOption,
  CreateIterationInput,
  UpdateIterationInput,
  IterationFilters,
} from '../iteration.types';

export const ITERATION_REPOSITORY = Symbol('ITERATION_REPOSITORY');

export interface IIterationRepository {
  findById(id: string): Promise<Iteration | null>;
  /** The single committed iteration for a project, if any. */
  findCommitted(projectId: string): Promise<Iteration | null>;
  listByProject(
    projectId: string,
    tenantId: string,
    filters: IterationFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Iteration>>;
  /**
   * Compact list for the assignment-options picker. Returns only
   * `planning` and `committed` iterations; never paginated.
   */
  listAssignmentOptions(
    projectId: string,
    tenantId: string,
    teamId?: string,
  ): Promise<IterationOption[]>;
  /** Next per-project iteration number (drives the IT-<n> display key). */
  nextKeyNumber(projectId: string, tenantId: string): Promise<number>;
  create(input: CreateIterationInput): Promise<Iteration>;
  update(id: string, input: UpdateIterationInput): Promise<Iteration>;
  delete(id: string): Promise<void>;
}
