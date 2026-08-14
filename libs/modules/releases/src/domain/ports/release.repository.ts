import type { CursorPayload, PagedResult } from '@platform';
import type {
  Release,
  ReleaseOption,
  CreateReleaseInput,
  UpdateReleaseInput,
} from '../release.types';

export const RELEASE_REPOSITORY = Symbol('RELEASE_REPOSITORY');

export interface IReleaseRepository {
  findById(id: string): Promise<Release | null>;
  listByProject(
    projectId: string,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Release>>;
  /**
   * The REFERENCE feed behind `GET /releases/options`: every release in the project, projected to
   * what a picker needs. A separate query rather than a projection of {@link listByProject}, so the
   * administrative columns are never read for a participant's request at all — and so no page
   * cursor can truncate an option list.
   */
  listOptionsByProject(projectId: string, workspaceId: string): Promise<ReleaseOption[]>;
  create(input: CreateReleaseInput): Promise<Release>;
  update(id: string, input: UpdateReleaseInput): Promise<Release>;
  delete(id: string): Promise<void>;
  /** Next per-project display-key number (MAX existing suffix + 1) for `RE-<n>`. */
  nextKeyNumber(projectId: string, workspaceId: string): Promise<number>;
}
