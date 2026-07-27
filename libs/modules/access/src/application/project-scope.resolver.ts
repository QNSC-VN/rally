import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle, NotFoundException } from '@platform';
import type { DrizzleDB, ErrorCode } from '@platform';
import { workItems, iterations, releases, milestones } from '../../../../../db/schema/work';

/**
 * Resource kinds whose project scope the PolicyGuard resolves by LOADING the row
 * (for endpoints where the project id is only reachable via `:id`, not the
 * request body/query). Tasks are nested under work-items (`/:id/tasks`), so a
 * task endpoint resolves via its parent's `work_item` id — no `task` kind needed.
 */
export type ScopedResource = 'work_item' | 'iteration' | 'release' | 'milestone';

const TABLES = {
  work_item: workItems,
  iteration: iterations,
  release: releases,
  milestone: milestones,
} as const;

const NOT_FOUND: Record<ScopedResource, [ErrorCode, string]> = {
  work_item: ['WORK_ITEM_NOT_FOUND', 'Work item not found'],
  iteration: ['ITERATION_NOT_FOUND', 'Iteration not found'],
  release: ['RELEASE_NOT_FOUND', 'Release not found'],
  milestone: ['MILESTONE_NOT_FOUND', 'Milestone not found'],
};

/**
 * Resolves a scoped resource's owning `projectId` for the PolicyGuard. One
 * indexed PK+workspace lookup; a missing row throws the resource's NotFound so a
 * bad id is a clean 404, not a misleading 403. Workspace-scoped in the WHERE so
 * the lookup itself can never cross tenants.
 */
@Injectable()
export class ProjectScopeResolver {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async resolve(resource: ScopedResource, id: string, workspaceId: string): Promise<string> {
    const table = TABLES[resource];
    const rows = await this.db
      .select({ projectId: table.projectId })
      .from(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
      .limit(1);
    const projectId = rows[0]?.projectId;
    if (!projectId) {
      const [code, message] = NOT_FOUND[resource];
      throw new NotFoundException(code, message);
    }
    return projectId;
  }
}
