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
    return (rows[0] as unknown as Release) ?? null;
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

    return buildPageResult(rows as unknown as Release[], limit, (r) => [r.createdAt.toISOString()]);
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
        theme: input.theme,
        startDate: input.startDate,
        releaseDate: input.releaseDate,
        status: input.status ?? 'planning',
      })
      .returning();
    return rows[0] as unknown as Release;
  }

  async update(id: string, input: UpdateReleaseInput): Promise<Release> {
    const set: Record<string, unknown> = { updatedAt: new Date() };

    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.theme !== undefined) set.theme = input.theme;
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.startDate !== undefined) set.startDate = input.startDate;
    if (input.releaseDate !== undefined) set.releaseDate = input.releaseDate;
    if (input.plannedVelocity !== undefined) set.plannedVelocity = input.plannedVelocity;
    if (input.planEstimate !== undefined) set.planEstimate = String(input.planEstimate);
    if (input.version !== undefined) set.version = input.version;
    if (input.status !== undefined) set.status = input.status;
    if (input.releasedAt !== undefined) set.releasedAt = input.releasedAt;

    const rows = await this.db
      .update(releases)
      .set(set)
      .where(eq(releases.id, id))
      .returning();
    return rows[0] as unknown as Release;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(releases).where(eq(releases.id, id));
  }
}