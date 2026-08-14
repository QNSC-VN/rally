import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
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
    workspaceId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Release>> {
    const conditions = [eq(releases.projectId, projectId), eq(releases.workspaceId, workspaceId)];

    if (cursor) {
      conditions.push(keysetCondition(releases.createdAt, releases.id, cursor));
    }

    const rows = await this.db
      .select()
      .from(releases)
      .where(and(...conditions))
      .orderBy(asc(releases.createdAt), asc(releases.id))
      .limit(limit + 1);

    return buildPageResult(rows as unknown as Release[], limit, (r) => [r.createdAt.toISOString()]);
  }

  async create(input: CreateReleaseInput): Promise<Release> {
    const rows = await this.db
      .insert(releases)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        releaseKey: input.releaseKey ?? null,
        name: input.name,
        description: input.description,
        theme: input.theme,
        startDate: input.startDate,
        releaseDate: input.releaseDate,
        status: input.status ?? 'planning',
        releaseNotes: input.releaseNotes,
      })
      .returning();
    return rows[0] as unknown as Release;
  }

  async nextKeyNumber(projectId: string, workspaceId: string): Promise<number> {
    // MAX(existing numeric suffix) + 1 (not count+1): releases can be deleted,
    // so count() would reissue a key a surviving row still holds. POSIX
    // '[0-9]+$' (no backslash) — Drizzle's sql template drops a bare '\' before
    // it reaches Postgres, so a '\d' pattern silently matches nothing. Still
    // not atomic under concurrent creates, so createRelease retries on the
    // uq_releases_key violation this can't fully rule out.
    const rows = await this.db
      .select({
        n: sql<number>`COALESCE(MAX(substring(${releases.releaseKey} from '[0-9]+$')::int), 0)::int`,
      })
      .from(releases)
      .where(and(eq(releases.projectId, projectId), eq(releases.workspaceId, workspaceId)));
    return (rows[0]?.n ?? 0) + 1;
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
    /**
     * `null` CLEARS the field; it must not be stringified.
     *
     * This was `String(input.planEstimate)`, so clearing Plan Estimate sent the four-character
     * string `"null"` into a `numeric(8,2)` column and every attempt answered 500. Reachable from
     * the release detail form by emptying the field — the one gesture that means "I do not have an
     * estimate yet".
     *
     * `undefined` still means "not in this PATCH" and is filtered by the guard; only an explicit
     * `null` reaches the column, which is what makes the field clearable at all. Drizzle wants a
     * string for `numeric` (it preserves precision that a JS number would not), hence the cast on
     * the non-null branch.
     */
    if (input.planEstimate !== undefined)
      set.planEstimate = input.planEstimate === null ? null : String(input.planEstimate);
    if (input.version !== undefined) set.version = input.version;
    if (input.status !== undefined) set.status = input.status;
    if (input.releasedAt !== undefined) set.releasedAt = input.releasedAt;
    if (input.releaseNotes !== undefined) set.releaseNotes = input.releaseNotes;

    const rows = await this.db.update(releases).set(set).where(eq(releases.id, id)).returning();
    return rows[0] as unknown as Release;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(releases).where(eq(releases.id, id));
  }
}
