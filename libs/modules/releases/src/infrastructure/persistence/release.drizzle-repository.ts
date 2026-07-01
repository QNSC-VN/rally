import { Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import { releases } from '../../../../../../db/schema/work';
import type { Release, CreateReleaseInput, UpdateReleaseInput } from '../../domain/release.types';
import { IReleaseRepository } from '../../domain/ports/release.repository';

@Injectable()
export class ReleaseDrizzleRepository implements IReleaseRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Release | null> {
    const rows = await this.db.select().from(releases).where(eq(releases.id, id)).limit(1);
    return (rows[0] as Release | undefined) ?? null;
  }

  async listByProject(
    projectId: string,
    tenantId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Release>> {
    const conditions = [eq(releases.projectId, projectId), eq(releases.tenantId, tenantId)];

    if (cursor) {
      conditions.push(lt(releases.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(releases)
      .where(and(...conditions))
      .orderBy(releases.createdAt)
      .limit(limit + 1);

    return buildPageResult(rows as Release[], limit, (r) => [r.createdAt.toISOString()]);
  }

  async create(input: CreateReleaseInput): Promise<Release> {
    const rows = await this.db
      .insert(releases)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        targetDate: input.targetDate,
      })
      .returning();
    return rows[0] as Release;
  }

  async update(id: string, input: UpdateReleaseInput): Promise<Release> {
    const rows = await this.db
      .update(releases)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.releasedAt !== undefined && { releasedAt: input.releasedAt }),
        updatedAt: new Date(),
      })
      .where(eq(releases.id, id))
      .returning();
    return rows[0] as Release;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(releases).where(eq(releases.id, id));
  }
}
