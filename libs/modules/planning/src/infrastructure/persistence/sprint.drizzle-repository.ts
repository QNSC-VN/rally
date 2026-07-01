import { Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import { sprints } from '../../../../../../db/schema/work';
import type { Sprint, CreateSprintInput, UpdateSprintInput } from '../../domain/sprint.types';
import { ISprintRepository } from '../../domain/ports/sprint.repository';

@Injectable()
export class SprintDrizzleRepository implements ISprintRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Sprint | null> {
    const rows = await this.db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
    return (rows[0] as Sprint | undefined) ?? null;
  }

  async findActive(projectId: string): Promise<Sprint | null> {
    const rows = await this.db
      .select()
      .from(sprints)
      .where(and(eq(sprints.projectId, projectId), eq(sprints.status, 'active')))
      .limit(1);
    return (rows[0] as Sprint | undefined) ?? null;
  }

  async listByProject(
    projectId: string,
    tenantId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Sprint>> {
    const conditions = [eq(sprints.projectId, projectId), eq(sprints.tenantId, tenantId)];

    if (cursor) {
      conditions.push(lt(sprints.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(sprints)
      .where(and(...conditions))
      .orderBy(sprints.createdAt)
      .limit(limit + 1);

    return buildPageResult(rows as Sprint[], limit, (s) => [s.createdAt.toISOString()]);
  }

  async create(input: CreateSprintInput): Promise<Sprint> {
    const rows = await this.db
      .insert(sprints)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        name: input.name,
        goal: input.goal,
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();
    return rows[0] as Sprint;
  }

  async update(id: string, input: UpdateSprintInput): Promise<Sprint> {
    const rows = await this.db
      .update(sprints)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.goal !== undefined && { goal: input.goal }),
        ...(input.startDate !== undefined && { startDate: input.startDate }),
        ...(input.endDate !== undefined && { endDate: input.endDate }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
        updatedAt: new Date(),
      })
      .where(eq(sprints.id, id))
      .returning();
    return rows[0] as Sprint;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sprints).where(eq(sprints.id, id));
  }
}
