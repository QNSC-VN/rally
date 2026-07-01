import type { CursorPayload, PagedResult } from '@platform';
import type { Sprint, CreateSprintInput, UpdateSprintInput } from '../sprint.types';

export const SPRINT_REPOSITORY = Symbol('SPRINT_REPOSITORY');

export interface ISprintRepository {
  findById(id: string): Promise<Sprint | null>;
  findActive(projectId: string): Promise<Sprint | null>;
  listByProject(
    projectId: string,
    tenantId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Sprint>>;
  create(input: CreateSprintInput): Promise<Sprint>;
  update(id: string, input: UpdateSprintInput): Promise<Sprint>;
  delete(id: string): Promise<void>;
}
