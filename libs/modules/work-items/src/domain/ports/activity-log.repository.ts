import type { DbExecutor } from '@platform';
import type { ActivityLog, CreateActivityLogInput } from '../activity-log.types';

export const ACTIVITY_LOG_REPOSITORY = Symbol('ACTIVITY_LOG_REPOSITORY');

export interface IActivityLogRepository {
  /**
   * Append a single revision entry atomically with the business mutation.
   * MUST be called with the same `executor` (tx) as the mutation.
   */
  append(input: CreateActivityLogInput, executor?: DbExecutor): Promise<void>;

  /**
   * Batch-insert multiple revision entries in one SQL statement.
   * Use this when a single mutation produces N field-diff entries to avoid
   * N sequential round-trips inside the transaction.
   * No-op when inputs is empty.
   */
  appendMany(inputs: CreateActivityLogInput[], executor?: DbExecutor): Promise<void>;

  /** Newest-first history for one work item (includes its task activity). */
  listByWorkItem(
    workItemId: string,
    tenantId: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }>;
}
