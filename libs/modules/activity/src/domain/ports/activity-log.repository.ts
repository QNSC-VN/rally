import type { DbExecutor } from '@platform';
import type { ActivityPage, CreateActivityInput } from '../activity-log.types';

export const ACTIVITY_LOG_REPOSITORY = Symbol('ACTIVITY_LOG_REPOSITORY');

export interface IActivityLogRepository {
  /** Append entries in ONE batched insert. Pass a tx executor to join a UoW. */
  appendMany(inputs: CreateActivityInput[], executor?: DbExecutor): Promise<void>;

  /**
   * Newest-first history for one entity. Returns rows whose `entity_id` OR
   * `context_id` equals `entityId`, so a parent's history includes its children
   * (e.g. a work item's tasks/attachments). Ids are globally unique so no
   * entity_type filter is needed — which is exactly why `workspaceId` is
   * mandatory: it is the only thing keeping a borrowed id from resolving to
   * another workspace's history.
   */
  listFor(
    entityId: string,
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<ActivityPage>;
}
