import type {
  IterationActivityLog,
  CreateIterationActivityLogInput,
} from '../activity-log.types';

export const ITERATION_ACTIVITY_LOG_REPOSITORY = Symbol('ITERATION_ACTIVITY_LOG_REPOSITORY');

export interface IIterationActivityLogRepository {
  /** Append a single revision entry. */
  append(input: CreateIterationActivityLogInput): Promise<void>;

  /**
   * Batch-insert multiple revision entries in one SQL statement (a single
   * update can produce N field-diff entries). No-op when inputs is empty.
   */
  appendMany(inputs: CreateIterationActivityLogInput[]): Promise<void>;

  /** Newest-first revision history for one iteration. */
  listByIteration(
    iterationId: string,
    workspaceId: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: IterationActivityLog[]; total: number }>;
}
