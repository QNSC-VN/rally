import type { Watcher } from '../watcher.types';

export const WATCHER_REPOSITORY = Symbol('WATCHER_REPOSITORY');

export interface IWatcherRepository {
  listByWorkItem(workItemId: string, tenantId: string): Promise<Watcher[]>;

  isWatching(workItemId: string, userId: string): Promise<boolean>;

  /** No-op (idempotent) if the user is already watching. */
  watch(workItemId: string, userId: string, tenantId: string): Promise<void>;

  /** No-op (idempotent) if the user is not watching. */
  unwatch(workItemId: string, userId: string): Promise<void>;

  /** Auto-watch a set of users — used for creator/assignee/commenter rules. */
  watchMany(
    workItemId: string,
    userIds: string[],
    tenantId: string,
  ): Promise<void>;

  /** Returns user IDs of all watchers — used for notification fan-out. */
  listUserIds(workItemId: string): Promise<string[]>;
}
