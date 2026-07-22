import type { CursorPayload, PagedResult } from '@platform';
import type { Release, CreateReleaseInput, UpdateReleaseInput } from '../release.types';

export const RELEASE_REPOSITORY = Symbol('RELEASE_REPOSITORY');

export interface IReleaseRepository {
  findById(id: string): Promise<Release | null>;
  listByProject(
    projectId: string,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Release>>;
  create(input: CreateReleaseInput): Promise<Release>;
  update(id: string, input: UpdateReleaseInput): Promise<Release>;
  delete(id: string): Promise<void>;
  /** Next per-project display-key number (MAX existing suffix + 1) for `RE-<n>`. */
  nextKeyNumber(projectId: string, workspaceId: string): Promise<number>;
}